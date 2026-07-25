/*
 * @Author: Andrew q
 * @Date: 2026-04-29 18:53:35
 * @LastEditors: Andrew Q
 * @LastEditTime: 2026-07-20 21:16:38
 * @Description: llm
 */
import { ChatOpenAI } from '@langchain/openai'
import { SILICONFLOW_BASE_URL } from '@data-agent/shared'
import { getSiliconflowApiKey, SILICONFLOW_LLM_MODEL } from '../config'

export function createChatModel() {
  return new ChatOpenAI({
    apiKey: getSiliconflowApiKey(),
    model: SILICONFLOW_LLM_MODEL,
    temperature: 0,
    configuration: {
      baseURL: SILICONFLOW_BASE_URL,
    },
  })
}
