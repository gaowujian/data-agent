import { ChatOpenAI } from '@langchain/openai'
import { SILICONFLOW_BASE_URL } from '@data-agent/shared'

const getSiliconflowApiKey = () => {
  return (
    process.env.SILICONFLOW_API_KEY ||
    'sk-iahzakhugqhjumnujxnfyimeomzblgwuyqatdtxnblhgpznw'
  )
}
export function createChatModel() {
  return new ChatOpenAI({
    apiKey: getSiliconflowApiKey(),
    model: 'deepseek-ai/DeepSeek-V4-Flash',
    temperature: 0,
    configuration: {
      baseURL: SILICONFLOW_BASE_URL,
    },
  })
}
