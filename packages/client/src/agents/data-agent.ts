import type { DownloadArtifact, DeepChatMessage } from '@data-agent/shared'
import { spreadsheetCellEditSchema } from '@data-agent/shared'
import { createDeepAgent, StateBackend } from 'deepagents'
import { tool } from 'langchain'
import { createChatModel } from './llm'
import { createPreloadedSkillMiddleware } from './preloaded-skill-middleware'
import { getFileRecord } from '../services/file-ingest'
import {
  createSkillPermissions,
  createSkillsBackend,
  type ResolvedAgentSkills,
} from '../services/skill-registry'
import {
  commitWorkbookCellEdit,
  getWorkbookRecord,
  type WorkbookEditCommit,
} from '../services/workbook-store'
import {
  formatWorkbookContextForAgent,
  formatWorkbookSamplesForResponse,
} from '../services/workbook-context'

export type DataAgentResult = {
  text: string
  artifact?: DownloadArtifact
  committedWorkbook?: WorkbookEditCommit
}

export type DataAgentRunner = (input: {
  fileId: string
  messages: DeepChatMessage[]
  question: string
  ragContext?: string
  skills: ResolvedAgentSkills
}) => Promise<DataAgentResult>

export type DataAgentStreamInput = {
  fileId: string
  messages: DeepChatMessage[]
  question: string
  ragContext?: string
  skills: ResolvedAgentSkills
  signal: AbortSignal
}

export type DataAgentStream = {
  text: AsyncIterable<string>
  getResult: () => DataAgentResult
}

export type DataAgentStreamRunner = (
  input: DataAgentStreamInput,
) => DataAgentStream

function asksForSheetNames(question: string): boolean {
  const normalized = question.toLocaleLowerCase()
  const mentionsSheet = /sheet|工作表|页签|tab/u.test(normalized)
  const asksForList = /有哪些|哪几个|列出|列表|名称|名字|多少个|几张|几个|list/u.test(
    normalized,
  )
  return mentionsSheet && asksForList
}

function asksForWorkbookOverview(question: string): boolean {
  const normalized = question.toLocaleLowerCase()
  const mentionsWorkbook = /excel|sheet|工作表|页签|表格|文件/u.test(normalized)
  const asksForOverview =
    /字段|列名|表头|行数|列数|数据概况|数据结构|有哪些数据/u.test(normalized)
  return mentionsWorkbook && asksForOverview
}

function asksForWorkbookSamples(question: string): boolean {
  return /内容|数据|样例|示例|前几行|记录/u.test(question.toLocaleLowerCase())
}

function createWorkbookMetadataResult(
  fileId: string,
  question: string,
  skills: ResolvedAgentSkills,
): DataAgentResult | undefined {
  if (!asksForSheetNames(question) && !asksForWorkbookOverview(question)) {
    return undefined
  }

  const record = getWorkbookRecord(fileId)
  if (!record) throw new Error('未找到可编辑的 XLSX，请重新上传文件')

  const skillPrefix = skills.names.length
    ? `已加载 Skill：${skills.names.join('、')}。\n`
    : ''
  if (asksForWorkbookOverview(question)) {
    const sheetDetails = record.context.sheets
      .map((sheet, index) => {
        const headers = sheet.headers.length
          ? `字段：${sheet.headers.join('、')}${sheet.headersTruncated ? '（已截断）' : ''}`
          : '未识别到表头'
        return `${index + 1}. ${sheet.name}：${sheet.rowCount} 行数据，${sheet.columnCount} 列；${headers}`
      })
      .join('\n')
    const sampleSection = asksForWorkbookSamples(question)
      ? `\n\n有限样例数据：\n${formatWorkbookSamplesForResponse(record.context)}`
      : ''
    return {
      text: `${skillPrefix}已读取 Excel 文件“${record.fileName}”的工作簿概要：\n${sheetDetails}${sampleSection}\n\n${getIndexStatusText(fileId)}`,
    }
  }

  const sheetList = record.sheetNames
    .map((sheetName, index) => `${index + 1}. ${sheetName}`)
    .join('\n')
  return {
    text: `${skillPrefix}已读取 Excel 文件“${record.fileName}”，共 ${record.sheetNames.length} 个工作表：\n${sheetList}`,
  }
}

function getIndexStatusText(fileId: string): string {
  const index = getFileRecord(fileId)
  if (!index) return '详细数据索引状态未知，仅可依据工作簿概要和样例数据回答。'
  if (index.status === 'completed') {
    return '详细数据索引已完成，可结合检索到的数据块回答。'
  }
  if (index.status === 'failed') {
    return '详细数据索引失败，当前只能依据工作簿概要和有限样例数据回答。'
  }
  return '详细数据索引仍在处理中，当前先依据工作簿概要和有限样例数据回答；不得声称已读取完整文件。'
}

function getTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'text' in item) {
        const text = (item as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function getLastAssistantText(result: unknown): string {
  if (!result || typeof result !== 'object' || !('messages' in result)) return ''
  const messages = (result as { messages?: unknown }).messages
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || typeof message !== 'object') continue
    if ('content' in message) {
      const text = getTextContent((message as { content?: unknown }).content)
      if (text) return text
    }
  }
  return ''
}

function toAgentMessages(messages: DeepChatMessage[], question: string) {
  const normalized = messages
    .filter((message) => message.text?.trim())
    .map((message) => ({
      role: message.role === 'ai' ? 'assistant' : (message.role ?? 'user'),
      content: message.text?.trim() ?? '',
    }))
  if (normalized.length === 0) {
    return [{ role: 'user' as const, content: question }]
  }
  if (normalized[normalized.length - 1]?.content !== question) {
    normalized.push({ role: 'user', content: question })
  }
  return normalized
}

export function createDataAgent(
  fileId: string,
  ragContext: string | undefined,
  skills: ResolvedAgentSkills,
) {
  const record = getWorkbookRecord(fileId)
  if (!record) throw new Error('未找到可编辑的 XLSX，请重新上传文件')

  const expectedVersion = record.currentVersion
  let mutationCount = 0
  let committedWorkbook: WorkbookEditCommit | undefined

  const editCell = tool(
    async (input) => {
      if (mutationCount > 0) {
        throw new Error('每轮对话只允许修改一个单元格')
      }
      mutationCount += 1
      committedWorkbook = commitWorkbookCellEdit(fileId, expectedVersion, input)
      return JSON.stringify({
        success: true,
        artifact: committedWorkbook.artifact,
        message: `已修改 ${input.sheetName}!${input.cellAddress}`,
      })
    },
    {
      name: 'edit_xlsx_cell',
      description:
        '修改当前请求绑定 XLSX 的一个单元格。每轮只能调用一次；sheetName、cellAddress、valueKind 和需要的 value 完整时才能调用。',
      schema: spreadsheetCellEditSchema,
    },
  )

  const contextSection = ragContext
    ? `\n以下是当前版本工作簿索引检索到的只读上下文，仅用于回答问题，不得据此猜测修改参数：\n${ragContext}`
    : ''
  const workbookContextSection = `\n以下是服务端从当前上传文件同步读取的真实工作簿概要和有限样例数据：\n${formatWorkbookContextForAgent(record.context)}\n${getIndexStatusText(fileId)}`
  const skillSection = skills.instructions
    ? `\n以下是本轮已由服务端完整加载的 Skill 正文，直接遵循其指令：\n${skills.instructions}`
    : ''
  const systemPrompt = `你是 Data Agent，当前绑定文件为“${record.fileName}”，版本 ${expectedVersion}，工作表精确名称为：${record.sheetNames.join('、')}。
你的唯一写操作是 edit_xlsx_cell，fileId 和版本已由服务端绑定，绝不能要求用户提供或自行选择它们。
严格遵守：
1. 每轮最多修改一个单元格。用户要求多个单元格时，不调用工具，明确请用户逐个操作。
2. 缺少精确 sheet 名、单个 A1 地址、值或值类型时，不调用工具，用简洁中文追问缺失参数。
3. 参数完整时调用工具一次；只有工具成功后才能说修改成功，并提醒用户下载新版本。
4. 日期一律按文本写入。公式必须保留开头的等号。禁止外部工作簿、URL、DDE 或外部数据函数。
5. 用户询问“有哪些 Sheet / 工作表 / 页签”时，直接列出上面的精确工作表名称；不要调用工具或尝试读取 Excel 文件。
6. 工作簿概要和样例数据已由服务端读取并提供在下方。不得回复“让我先读取文件”或把读取动作写成普通文本；数据不足时，基于索引状态说明限制。
7. 已选 Skill 的 SKILL.md 正文已在下方加载，禁止重新读取 SKILL.md；仅当其正文明确要求同一 Skill 目录中的其他文件时，才可读取该文件。
8. 除 edit_xlsx_cell 和上一条明确允许的 Skill 支持文件外，不得创建、读取或写入其他文件。${workbookContextSection}${contextSection}${skillSection}`

  return {
    agent: createDeepAgent({
      model: createChatModel(),
      tools: [editCell],
      systemPrompt: { prefix: systemPrompt, base: null },
      backend:
        skills.names.length > 0 ? createSkillsBackend() : new StateBackend(),
      skills: skills.sources,
      permissions: createSkillPermissions(skills.names),
      middleware: createPreloadedSkillMiddleware(skills),
    }),
    getCommittedWorkbook: () => committedWorkbook,
  }
}

export const runDataAgent: DataAgentRunner = async ({
  fileId,
  messages,
  question,
  ragContext,
  skills,
}) => {
  const workbookMetadataResult = createWorkbookMetadataResult(
    fileId,
    question,
    skills,
  )
  if (workbookMetadataResult) return workbookMetadataResult

  const { agent, getCommittedWorkbook } = createDataAgent(
    fileId,
    ragContext,
    skills,
  )
  const result = await agent.invoke({
    messages: toAgentMessages(messages, question),
  })
  const committedWorkbook = getCommittedWorkbook()
  return {
    text:
      getLastAssistantText(result) ||
      (committedWorkbook
        ? '单元格已修改，请下载新版本。'
        : '请补充需要修改的工作表、单元格地址和值。'),
    artifact: committedWorkbook?.artifact,
    committedWorkbook,
  }
}

export const streamDataAgent: DataAgentStreamRunner = ({
  fileId,
  messages,
  question,
  ragContext,
  skills,
  signal,
}) => {
  const workbookMetadataResult = createWorkbookMetadataResult(
    fileId,
    question,
    skills,
  )
  if (workbookMetadataResult) {
    return {
      text: (async function* () {
        yield workbookMetadataResult.text
      })(),
      getResult: () => workbookMetadataResult,
    }
  }

  const { agent, getCommittedWorkbook } = createDataAgent(
    fileId,
    ragContext,
    skills,
  )
  let streamedText = ''

  return {
    text: (async function* () {
      const run = await agent.streamEvents(
        { messages: toAgentMessages(messages, question) },
        { version: 'v3', signal },
      )

      for await (const message of run.messages) {
        for await (const delta of message.text) {
          if (!delta) continue
          streamedText += delta
          yield delta
        }
      }

      if (!streamedText) {
        const committedWorkbook = getCommittedWorkbook()
        streamedText = committedWorkbook
          ? '单元格已修改，请下载新版本。'
          : '请补充需要修改的工作表、单元格地址和值。'
        yield streamedText
      }
    })(),
    getResult: () => {
      const committedWorkbook = getCommittedWorkbook()
      return {
        text:
          streamedText ||
          (committedWorkbook
            ? '单元格已修改，请下载新版本。'
            : '请补充需要修改的工作表、单元格地址和值。'),
        artifact: committedWorkbook?.artifact,
        committedWorkbook,
      }
    },
  }
}
