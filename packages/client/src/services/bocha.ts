import { z } from 'zod'
import { getBochaApiKey } from '../config'

const bochaWebSearchResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  msg: z.string().optional(),
  data: z
    .object({
      webPages: z
        .object({
          value: z
            .array(
              z.object({
                name: z.string().optional(),
                url: z.string().optional(),
                summary: z.string().optional(),
                siteName: z.string().optional(),
                siteIcon: z.string().optional(),
                dateLastCrawled: z.string().optional(),
              }),
            )
            .default([]),
        })
        .optional(),
    })
    .optional(),
})

export async function searchWeb(query: string, count = 10): Promise<string> {
  const response = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getBochaApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      freshness: 'noLimit',
      summary: true,
      count,
    }),
  })

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return '搜索 API 请求失败，原因是：搜索结果解析失败。'
  }

  if (!response.ok) return `搜索 API 请求失败，状态码: ${response.status}`

  const parsed = bochaWebSearchResponseSchema.safeParse(payload)
  if (!parsed.success) return '搜索 API 请求失败，原因是：搜索结果格式异常。'
  if (parsed.data.code !== undefined && String(parsed.data.code) !== '200') {
    return `搜索 API 请求失败，原因是: ${parsed.data.msg ?? '未知错误'}`
  }

  const webpages = parsed.data.data?.webPages?.value ?? []
  if (!webpages.length) return '未找到相关结果。'

  return webpages
    .map(
      (page, index) => `引用: ${index + 1}
标题: ${page.name ?? ''}
URL: ${page.url ?? ''}
摘要: ${page.summary ?? ''}
网站名称: ${page.siteName ?? ''}
网站图标: ${page.siteIcon ?? ''}
发布时间: ${page.dateLastCrawled ?? ''}`,
    )
    .join('\n\n')
}
