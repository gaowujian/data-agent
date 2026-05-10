import type { ChatBaseContent } from 'tdesign-web-components/lib/chat-engine'

/**
 * 扩展 TDesign Web Components Chat 引擎的 AI 内容联合类型。
 * 库在 chat-engine/type.d.ts 中将 AIContentTypeMap 与 AIContentTypeOverrides 做交叉类型合并。
 */
declare global {
  interface AIContentTypeOverrides {
    /** 自定义图表流式块；与模板 item.type === 'chart'、TvisionTcharts 一致 */
    chart: ChatBaseContent<'chart', { id: number } & Record<string, unknown>>
  }
}

export {}
