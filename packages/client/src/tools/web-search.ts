import { tool } from 'langchain'
import { z } from 'zod'
import { searchWeb } from '../services/bocha'

const webSearchArgsSchema = z.object({
  query: z.string().min(1).describe('搜索关键词，例如：公司年报、某个事件等'),
  count: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('返回的搜索结果数量，默认 10 条'),
})

export const webSearchTool = tool(
  ({ query, count }) => searchWeb(query, count),
  {
    name: 'web_search',
    description: '搜索互联网获取最新信息',
    schema: webSearchArgsSchema,
  },
)
