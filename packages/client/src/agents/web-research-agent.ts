import { createDeepAgent } from 'deepagents'
import { webSearchTool } from '../tools/web-search'
import { createChatModel } from './llm'

const WEB_RESEARCH_SYSTEM_PROMPT = `你是联网信息研究 Agent。

当用户要求实时、最新、新闻、联网查询、事实核查或研究时：
1. 在输出任何自然语言、计划或进度说明前，必须先调用 web_search；不要回复“我来搜索”等过程性文本。
2. 第一次搜索直接围绕用户的问题构造关键词。结果不足时可以改写关键词继续搜索，单次请求最多调用 3 次 web_search。
3. 收到搜索结果后再输出最终回答，基于结果中的 URL 给出可访问的来源链接；工具报错或无结果时如实说明，不能编造。
4. 不使用 write_todos、task、文件系统或其他与联网研究无关的工具。

对于不需要联网的普通对话，直接简洁回答。`

export function createWebResearchAgent() {
  return createDeepAgent({
    model: createChatModel(),
    systemPrompt: { base: WEB_RESEARCH_SYSTEM_PROMPT },
    tools: [webSearchTool],
  })
}
