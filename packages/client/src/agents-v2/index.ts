/*
 * @Author: Andrew Q
 * @Date: 2026-07-24 22:45:30
 * @LastEditors: Andrew Q
 * @LastEditTime: 2026-07-25 01:17:58
 * @Description: agent
 */
import { createDeepAgent } from "deepagents";
import { tool } from "langchain";
import { z } from "zod";

import { createChatModel } from "../agents/llm";

const webSearchArgsSchema = z.object({
  query: z.string().min(1).describe("搜索关键词，例如：公司年报、某个事件等"),
  count: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("返回的搜索结果数量，默认 10 条"),
});

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
});

async function search(query: string, count = 10): Promise<string> {
  const apiKey = process.env.BOCHA_API_KEY?.trim();
  if (!apiKey) return "服务端未配置 BOCHA_API_KEY。";

  const response = await fetch("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      freshness: "noLimit",
      summary: true,
      count,
    }),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return "搜索 API 请求失败，原因是：搜索结果解析失败。";
  }

  if (!response.ok) return `搜索 API 请求失败，状态码: ${response.status}`;

  const parsed = bochaWebSearchResponseSchema.safeParse(payload);
  if (!parsed.success) return "搜索 API 请求失败，原因是：搜索结果格式异常。";
  if (parsed.data.code !== undefined && String(parsed.data.code) !== "200") {
    return `搜索 API 请求失败，原因是: ${parsed.data.msg ?? "未知错误"}`;
  }

  const webpages = parsed.data.data?.webPages?.value ?? [];
  if (!webpages.length) return "未找到相关结果。";

  return webpages
    .map(
      (page, index) => `引用: ${index + 1}
标题: ${page.name ?? ""}
URL: ${page.url ?? ""}
摘要: ${page.summary ?? ""}
网站名称: ${page.siteName ?? ""}
网站图标: ${page.siteIcon ?? ""}
发布时间: ${page.dateLastCrawled ?? ""}`,
    )
    .join("\n\n");
}

const webSearch = tool(async ({ query, count }) => search(query, count), {
  name: "web_search",
  description: "搜索互联网获取最新信息",
  schema: webSearchArgsSchema,
});

export function createAgent() {
  const systemPrompt = `你是联网信息研究 Agent。

当用户要求实时、最新、新闻、联网查询、事实核查或研究时：
1. 在输出任何自然语言、计划或进度说明前，必须先调用 web_search；不要回复“我来搜索”等过程性文本。
2. 第一次搜索直接围绕用户的问题构造关键词。结果不足时可以改写关键词继续搜索，单次请求最多调用 3 次 web_search。
3. 收到搜索结果后再输出最终回答，基于结果中的 URL 给出可访问的来源链接；工具报错或无结果时如实说明，不能编造。
4. 不使用 write_todos、task、文件系统或其他与联网研究无关的工具。

对于不需要联网的普通对话，直接简洁回答。`;

  return createDeepAgent({
    model: createChatModel(),
    systemPrompt: { base: systemPrompt },
    tools: [webSearch],
  });
}
