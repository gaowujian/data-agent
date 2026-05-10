/*
 * @Author: Andrew q
 * @Date: 2026-04-30 10:58:31
 * @LastEditors: Andrew q
 * @LastEditTime: 2026-05-10 22:22:03
 * @Description: config
 */
import { SILICONFLOW_BASE_URL } from '@data-agent/shared'

const SILICONFLOW_API_KEY_DEV = ''

/** 与 SiliconFlow OpenAI 兼容接口共用的 Key（优先环境变量） */
export function getSiliconflowApiKey(): string {
  return SILICONFLOW_API_KEY_DEV
}

export { SILICONFLOW_BASE_URL }

/** 表格向量化使用的嵌入模型（中文友好） */
export const SILICONFLOW_EMBEDDING_MODEL = 'BAAI/bge-large-zh-v1.5'

/** 单次 embeddings 请求最多条数 */
export const SILICONFLOW_EMBED_BATCH_SIZE = 4

/** 单条送入嵌入模型的最大字符数  */
export const SILICONFLOW_EMBED_MAX_CHARS_PER_TEXT = 1800

/** 对话用 LLM（与 llm 模块保持一致时可单独改环境变量） */
export const SILICONFLOW_LLM_MODEL = 'deepseek-ai/DeepSeek-V4-Flash'
