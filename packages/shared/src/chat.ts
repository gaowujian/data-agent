/*
 * @Author: Andrew q
 * @Date: 2026-04-29 18:56:29
 * @LastEditors: Andrew q
 * @LastEditTime: 2026-04-30 17:12:34
 * @Description:
 */
import { z } from 'zod'

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  message: z.string(),
})

export type ChatMessage = z.infer<typeof chatMessageSchema>

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
    /** 关联 POST /api/files 返回的 fileId，与 message 一起用于 RAG 问答 */
    fileId: z.string().min(1).optional(),
    message: z.preprocess((v) => {
      if (typeof v === 'string') {
        const t = v.trim()
        return t.length > 0 ? t : undefined
      }
      return coerceMessageText(v)
    }, z.string().optional()),
    /**
     * 为 true 时，流式结束后再推送一条 type=chart 的 SSE，便于联调自定义渲染（如 ECharts）。
     * 生产环境可按业务条件传入。
     */
    includeEchartDemo: z.boolean().optional(),
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
