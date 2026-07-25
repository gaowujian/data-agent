/*
 * @Author: Andrew q
 * @Date: 2026-04-29 18:56:29
 * @LastEditors: Andrew Q
 * @LastEditTime: 2026-07-22 19:38:36
 * @Description:
 */
import { z } from 'zod'

export const DATA_AGENT_KEY = 'data-agent'

export const workbookIndexStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
])

export const workbookSheetSummarySchema = z.object({
  name: z.string().min(1),
  /** 表头之外的数据行数量 */
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  /** 已受服务端上限约束的非空表头 */
  headers: z.array(z.string().min(1)).max(50),
  headersTruncated: z.boolean(),
})

export const workbookFileResponseSchema = z.object({
  fileId: z.string().min(1),
  fileName: z.string().min(1),
  status: z.literal('ready'),
  sheetNames: z.array(z.string().min(1)).default([]),
  sheets: z.array(workbookSheetSummarySchema).default([]),
  indexStatus: workbookIndexStatusSchema,
  indexError: z.string().optional(),
})

export const downloadArtifactSchema = z.object({
  artifactId: z.string().min(1),
  fileName: z.string().min(1),
  downloadUrl: z.string().min(1),
  version: z.number().int().positive(),
})

export const spreadsheetCellEditSchema = z
  .object({
    sheetName: z.string().trim().min(1),
    cellAddress: z.string().trim().min(1),
    valueKind: z.enum(['text', 'number', 'boolean', 'blank', 'formula']),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.valueKind !== 'blank' && data.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '非 blank 类型必须提供 value',
        path: ['value'],
      })
    }
    if (data.valueKind === 'number' && typeof data.value !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'number 类型的 value 必须是数字',
        path: ['value'],
      })
    }
    if (data.valueKind === 'boolean' && typeof data.value !== 'boolean') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'boolean 类型的 value 必须是布尔值',
        path: ['value'],
      })
    }
    if (
      (data.valueKind === 'text' || data.valueKind === 'formula') &&
      typeof data.value !== 'string'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${data.valueKind} 类型的 value 必须是字符串`,
        path: ['value'],
      })
    }
    if (
      data.valueKind === 'formula' &&
      typeof data.value === 'string' &&
      !data.value.startsWith('=')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'formula 类型的 value 必须以 = 开头',
        path: ['value'],
      })
    }
  })

export const markdownStreamContentSchema = z.object({
  type: z.literal('markdown'),
  data: z.string(),
})

export const chartStreamContentSchema = z.object({
  type: z.literal('chart'),
  data: z.record(z.string(), z.unknown()),
})

export const downloadStreamContentSchema = z.object({
  type: z.literal('download'),
  data: downloadArtifactSchema,
})

export const chatStreamContentSchema = z.discriminatedUnion('type', [
  markdownStreamContentSchema,
  chartStreamContentSchema,
  downloadStreamContentSchema,
])

export type WorkbookIndexStatus = z.infer<typeof workbookIndexStatusSchema>
export type WorkbookSheetSummary = z.infer<typeof workbookSheetSummarySchema>
export type WorkbookFileResponse = z.infer<typeof workbookFileResponseSchema>
export type DownloadArtifact = z.infer<typeof downloadArtifactSchema>
export type SpreadsheetCellEdit = z.infer<typeof spreadsheetCellEditSchema>
export type ChatStreamContent = z.infer<typeof chatStreamContentSchema>

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  message: z.string(),
})

export type ChatMessage = z.infer<typeof chatMessageSchema>

export const agentSkillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Skill 名称只能包含小写字母、数字和连字符',
  )

export const agentSkillNamesSchema = z
  .array(agentSkillNameSchema)
  .max(20, '一次最多选择 20 个 Skill')
  .superRefine((names, ctx) => {
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Skill 名称不能重复',
      })
    }
  })

export const selectedAgentSkillsSchema = agentSkillNamesSchema.default([])

export const agentSkillSchema = z.object({
  name: agentSkillNameSchema,
  description: z.string().trim().min(1).max(1024),
})

export const agentSkillsResponseSchema = z.object({
  skills: z.array(agentSkillSchema),
})

export type AgentSkill = z.infer<typeof agentSkillSchema>
export type AgentSkillsResponse = z.infer<typeof agentSkillsResponseSchema>

export function coerceMessageText(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') {
    const t = value.trim()
    return t.length > 0 ? t : undefined
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'text' in item) {
        const inner = (item as { text?: unknown }).text
        return typeof inner === 'string' ? inner : ''
      }
      return ''
    })
    const joined = parts.filter(Boolean).join('\n').trim()
    return joined.length > 0 ? joined : undefined
  }
  if (typeof value === 'object' && 'text' in (value as object)) {
    return coerceMessageText((value as { text?: unknown }).text)
  }
  return undefined
}

export const deepChatMessageSchema = z.object({
  role: z.enum(['user', 'ai', 'assistant', 'system']).optional(),
  text: z.preprocess(coerceMessageText, z.string().optional()),
  /** 可挂在单条消息上；与顶层 fileId 二选一或并存（顶层 fileId 优先） */
  fileId: z.string().min(1).optional(),
})

/**
 * 解析 RAG 用的 fileId + 用户问题：
 * - 顶层 fileId + 顶层 message，或
 * - 顶层 fileId + messages 中任一条非空 text（取最后一条），或
 * - messages 中从后往前第一条带 fileId 的消息，取其 fileId 与同条 text（text 可从同条或后续兜底取最后一条 text）
 */
export function resolveDeepChatRagFields(data: {
  fileId?: string | undefined
  message?: string | undefined
  messages: Array<{ text?: string | undefined; fileId?: string | undefined }>
}): { fileId: string; message: string } | null {
  const topF = data.fileId?.trim()
  const topM = data.message?.trim()

  let nestedFileId: string | undefined
  let nestedText: string | undefined
  for (let i = data.messages.length - 1; i >= 0; i--) {
    const f = data.messages[i]?.fileId?.trim()
    if (f) {
      nestedFileId = f
      nestedText = data.messages[i]?.text?.trim()
      break
    }
  }

  const fileId = topF || nestedFileId
  if (!fileId) return null

  let message = topM || nestedText || ''
  if (!message) {
    for (let i = data.messages.length - 1; i >= 0; i--) {
      const t = data.messages[i]?.text?.trim()
      if (t) {
        message = t
        break
      }
    }
  }
  if (!message) return null
  return { fileId, message }
}

export const deepChatRequestSchema = z
  .object({
    messages: z.array(deepChatMessageSchema).default([]),
    fileId: z.string().min(1).optional(),
    message: z.preprocess((v) => {
      if (typeof v === 'string') {
        const t = v.trim()
        return t.length > 0 ? t : undefined
      }
      return coerceMessageText(v)
    }, z.string().optional()),
    includeEchartDemo: z.boolean().optional(),
    skills: selectedAgentSkillsSchema,
  })
  .superRefine((data, ctx) => {
    const wantsRag =
      Boolean(data.fileId?.trim()) ||
      data.messages.some((m) => Boolean(m.fileId?.trim()))
    const rag = resolveDeepChatRagFields(data)
    const legacyOk = data.messages.some((m) => m.text?.trim())

    if (wantsRag) {
      if (!rag) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            '使用 fileId 时请提供非空 message，或在 messages 中提供非空 text（可与 fileId 同条或分条）',
          path: ['messages'],
        })
      }
    } else if (!legacyOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '请提供 messages，或使用 fileId 与 message 进行基于文件的问答',
        path: ['messages'],
      })
    }
  })

export const deepChatResponseSchema = z.object({
  text: z.string(),
})

export type DeepChatMessage = z.infer<typeof deepChatMessageSchema>
export type DeepChatRequest = z.infer<typeof deepChatRequestSchema>
export type DeepChatResponse = z.infer<typeof deepChatResponseSchema>
