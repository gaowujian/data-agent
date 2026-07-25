import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type {
  DataAgentRunner,
  DataAgentStreamRunner,
} from '../agents/data-agent'
import { runDataAgent, streamDataAgent } from '../agents/data-agent'
import type {
  GeneralAgentStreamRunner,
} from '../agents/general-agent'
import { streamGeneralAgent } from '../agents/general-agent'
import { createWebResearchAgent } from '../agents/web-research-agent'
import { getBochaApiKey } from '../config'
import {
  getFileRecord,
  retrieveTopChunksByQuery,
  runIngestExcelJob,
} from '../services/file-ingest'
import {
  resolveAgentSkills,
  UnknownAgentSkillsError,
} from '../services/skill-registry'
import { getWorkbookRecord } from '../services/workbook-store'
import {
  DATA_AGENT_KEY,
  chatStreamRequestSchema,
  deepChatRequestSchema,
  resolveDeepChatRagFields,
  type ChatStreamMessage,
  type ChatStreamContent,
  type DeepChatMessage,
  type DeepChatResponse,
} from '@data-agent/shared'

const RAG_TOP_K = 6

export type ChatRoutesDependencies = {
  dataAgentRunner?: DataAgentRunner
  dataAgentStreamRunner?: DataAgentStreamRunner
  generalAgentStreamRunner?: GeneralAgentStreamRunner
}

function toAgentMessages(messages: DeepChatMessage[]): ChatStreamMessage[] {
  return messages.flatMap((message) => {
    const content = message.text?.trim()
    if (!content) return []
    const role: ChatStreamMessage['role'] =
      message.role === 'ai' ? 'assistant' : (message.role ?? 'user')
    return [
      {
        role,
        content,
      },
    ]
  })
}

function toDeepChatMessages(messages: ChatStreamMessage[]): DeepChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    text: message.content,
  }))
}

async function writeContentBlock(
  sse: SSEStreamingApi,
  block: ChatStreamContent,
): Promise<void> {
  await sse.writeSSE({ event: 'message', data: JSON.stringify(block) })
}

async function writeMarkdownDelta(
  sse: SSEStreamingApi,
  delta: string,
): Promise<void> {
  if (!delta) return
  await writeContentBlock(sse, { type: 'markdown', data: delta })
}

async function streamTextToSse(
  sse: SSEStreamingApi,
  stream: AsyncIterable<string>,
  signal: AbortSignal,
): Promise<void> {
  for await (const delta of stream) {
    if (signal.aborted) return
    await writeMarkdownDelta(sse, delta)
  }
}

async function collectStreamText(stream: AsyncIterable<string>): Promise<string> {
  let text = ''
  for await (const delta of stream) text += delta
  return text
}

async function writeSseError(
  sse: SSEStreamingApi,
  message: string,
): Promise<void> {
  await sse.writeSSE({ event: 'error', data: JSON.stringify({ message }) })
}

const DEMO_ECHART_OPTION = {
  title: { text: '示例：流式后的 chart 块', left: 'center' },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', data: ['Q1', 'Q2', 'Q3', 'Q4'] },
  yAxis: { type: 'value', name: '数值' },
  series: [
    {
      type: 'bar',
      name: '销量',
      data: [32, 58, 45, 71],
      itemStyle: { color: '#0052d9' },
    },
  ],
} as const

async function getOptionalRagContext(
  fileId: string,
  question: string,
): Promise<string | undefined> {
  if (getFileRecord(fileId)?.status !== 'completed') return undefined
  try {
    const snippets = await retrieveTopChunksByQuery(fileId, question, RAG_TOP_K)
    return snippets.length > 0 ? snippets.join('\n---\n') : undefined
  } catch {
    return undefined
  }
}

function publicServiceError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback
  const status =
    error && typeof error === 'object' && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined
  if (
    status === 401 ||
    /\b401\b|MODEL_AUTHENTICATION|authentication|unauthorized/i.test(message)
  ) {
    return '模型服务鉴权失败，请检查 SILICONFLOW_API_KEY 是否有效并重启后端服务'
  }
  return message
}

export function createChatRoutes(
  dependencies: ChatRoutesDependencies = {},
): Hono {
  const app = new Hono()
  const executeDataAgent = dependencies.dataAgentRunner ?? runDataAgent
  const executeDataAgentStream =
    dependencies.dataAgentStreamRunner ?? streamDataAgent
  const executeGeneralAgentStream =
    dependencies.generalAgentStreamRunner ?? streamGeneralAgent

  app.post('/chat', zValidator('json', deepChatRequestSchema), async (c) => {
    try {
      const body = c.req.valid('json')
      const skills = await resolveAgentSkills(body.skills)
      const rag = resolveDeepChatRagFields(body)
      if (rag && getWorkbookRecord(rag.fileId)) {
        const result = await executeDataAgent({
          fileId: rag.fileId,
          messages: body.messages,
          question: rag.message,
          ragContext: await getOptionalRagContext(rag.fileId, rag.message),
          skills,
        })
        return c.json({ text: result.text } satisfies DeepChatResponse)
      }

      let messages = toAgentMessages(body.messages)
      if (rag) {
        const index = getFileRecord(rag.fileId)
        if (!index) {
          return c.json({ error: '未找到该 fileId，请先上传文件' }, 404)
        }
        if (index.status !== 'completed') {
          return c.json(
            { error: index.error || '文件仍在建立索引，请稍后再试' },
            409,
          )
        }
        const snippets = await retrieveTopChunksByQuery(
          rag.fileId,
          rag.message,
          RAG_TOP_K,
        )
        messages = [
          ...messages,
          {
            role: 'user',
            content: `已知信息：${snippets.join('\n---\n') || '（暂无匹配片段）'}，请回答：${rag.message}`,
          },
        ]
      }

      const text = await collectStreamText(
        executeGeneralAgentStream({
          messages,
          skills,
          signal: c.req.raw.signal,
        }),
      )
      return c.json({
        text: text || '模型没有返回文本内容。',
      } satisfies DeepChatResponse)
    } catch (error) {
      return c.json(
        { error: publicServiceError(error, 'LLM 调用失败') },
        error instanceof UnknownAgentSkillsError ? 400 : 500,
      )
    }
  })

  app.post('/chat/stream', (c) => {
    const signal = c.req.raw.signal

    return streamSSE(c, async (sse) => {
      let agentKey: string | undefined
      try {
        const request = chatStreamRequestSchema.parse(await c.req.json<unknown>())
        agentKey = request.key
        const skills = await resolveAgentSkills(request.skills)

        if (request.key === DATA_AGENT_KEY) {
          const dataAgent = executeDataAgentStream({
            fileId: request.fileId,
            messages: toDeepChatMessages(request.messages),
            question: request.message,
            ragContext: await getOptionalRagContext(
              request.fileId,
              request.message,
            ),
            skills,
            signal,
          })
          await streamTextToSse(sse, dataAgent.text, signal)
          if (signal.aborted) return

          const result = dataAgent.getResult()
          if (result.artifact) {
            await writeContentBlock(sse, {
              type: 'download',
              data: result.artifact,
            })
          }
          if (result.committedWorkbook) {
            const workbook = getWorkbookRecord(request.fileId)
            if (workbook) {
              void runIngestExcelJob(
                request.fileId,
                result.committedWorkbook.buffer,
                workbook.fileName,
                result.artifact?.version ?? workbook.currentVersion,
              ).catch(() => undefined)
            }
          }
          return
        }

        await streamTextToSse(
          sse,
          executeGeneralAgentStream({
            messages: request.messages,
            skills,
            signal,
          }),
          signal,
        )
        if (request.includeEchartDemo && !signal.aborted) {
          await writeContentBlock(sse, {
            type: 'chart',
            data: DEMO_ECHART_OPTION,
          })
        }
      } catch (error) {
        if (signal.aborted) return
        const fallback =
          agentKey === DATA_AGENT_KEY
            ? 'Data Agent 调用失败'
            : '通用 Agent 调用失败'
        await writeSseError(sse, publicServiceError(error, fallback))
      }
    })
  })

  app.post('/chat/stream/v2', (c) => {
    const signal = c.req.raw.signal

    return streamSSE(c, async (sse) => {
      try {
        const request = chatStreamRequestSchema.parse(await c.req.json<unknown>())
        if (!request.messages.length) {
          await writeSseError(sse, '请提供至少一条非空消息')
          return
        }

        getBochaApiKey()
        const run = await createWebResearchAgent().streamEvents(
          { messages: request.messages },
          { version: 'v3', signal },
        )
        let hasText = false

        for await (const message of run.messages) {
          for await (const delta of message.text) {
            if (signal.aborted) return
            if (!delta) continue
            hasText = true
            await writeMarkdownDelta(sse, delta)
          }
        }

        if (!hasText && !signal.aborted) {
          await writeMarkdownDelta(sse, 'Agent 没有返回可展示的文本。')
        }
      } catch (error) {
        if (signal.aborted) return
        await writeSseError(
          sse,
          publicServiceError(error, '联网研究 Agent 调用失败'),
        )
      }
    })
  })

  return app
}
