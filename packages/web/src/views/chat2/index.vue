<!--
 * @Author: Andrew q
 * @Date: 2026-04-30 15:55:07
 * @LastEditors: Andrew q
 * @LastEditTime: 2026-05-10 21:36:02
 * @Description: chat2
-->
<template>
  <div class="chat-page">
    <section class="chat-card" aria-label="流式对话">
      <header class="chat-header">
        <h1 class="chat-title">Data Agent</h1>
        <p class="chat-subtitle">
          TDesign Chatbot · 流式 SSE · 自定义 chart + ECharts（includeEchartDemo）
        </p>
      </header>

      <div class="chat-bot-wrap">
        <div class="files-list">
          <t-attachments
            :items="filesList"
            @remove="handleFileRemove"
            :removable="true"
            overflow="scrollY"
          />
        </div>
        <t-chatbot
          ref="chatbotRef"
          :chat-service-config="chatServiceConfig"
          :list-props="listProps"
          :sender-props="senderProps"
          :message-props="messagePropsForChartSlots"
          @chat-ready="onChatEngineReady"
          @message-change="onMessageListChange"
        >
          <!-- 自定义渲染：插槽名为 `${messageId}-chart-${片段下标}`，与文档「自定义渲染」一致 -->
          <template v-for="b in chartSlotBindings" :key="b.name" #[b.name]>
            <TdesignChatChartSlot :option="b.option" />
          </template>
        </t-chatbot>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Chatbot } from '@tdesign-vue-next/chat'
import { ref, shallowRef } from 'vue'
import type {
  AIMessageContent,
  ChatMessagesData,
  ChatRequestParams,
  ChatServiceConfig,
  SSEChunkData,
  TdChatSenderActionName,
} from '@tdesign-vue-next/chat'
import TdesignChatChartSlot from '@/components/TdesignChatChartSlot.vue'

/** t-chatbot 将子插槽重命名为 `${messageId}-chart-${index}`，此处收集后动态绑定 */
type ChartSlotBinding = { name: string; option: Record<string, unknown> | undefined }

const chatbotRef = ref<InstanceType<typeof Chatbot> | null>(null)
const chartSlotBindings = shallowRef<ChartSlotBinding[]>([])

const collectChartSlotBindings = (messages: ChatMessagesData[]): ChartSlotBinding[] => {
  const out: ChartSlotBinding[] = []
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
    msg.content.forEach((block, idx) => {
      const typed = block as { type?: string; data?: unknown }
      if (typed.type === 'chart') {
        out.push({
          name: `${msg.id}-chart-${idx}`,
          option:
            typed.data && typeof typed.data === 'object'
              ? (typed.data as Record<string, unknown>)
              : undefined,
        })
      }
    })
  }
  return out
}

const onMessageListChange = (e: Event) => {
  const detail = (e as CustomEvent<ChatMessagesData[]>).detail
  chartSlotBindings.value = collectChartSlotBindings(detail ?? [])
}

/** 允许按内容片段挂 Vue 插槽（见 TDesign Chatbot 自定义渲染说明） */
const messagePropsForChartSlots = (msg: ChatMessagesData) =>
  msg.role === 'assistant' ? { allowContentSegmentCustom: true } : {}

/** 引擎就绪后再注册自定义类型的流式合并策略 */
const onChatEngineReady = () => {
  const api = chatbotRef.value as unknown as {
    registerMergeStrategy?: (type: string, fn: (chunk: unknown, existing?: unknown) => unknown) => void
  }
  // 自定义 chart：后端每次推完整 option，直接覆盖即可
  api.registerMergeStrategy?.('chart', (chunk) => chunk)
}

const listProps = {
  autoScroll: true,
  defaultScrollTo: 'bottom' as const,
}

const files = ref<any[]>([])
const filesList = ref<any[]>([])
const senderProps = {
  placeholder: '输入消息，Enter 发送，Shift+Enter 换行',
  autosize: { minRows: 2, maxRows: 6 },
  // 操作按钮
  actions: ['attachment', 'send'] as TdChatSenderActionName[],
  // 附件配置
  attachmentsProps: {
    items: files.value, // 附件列表
    overflow: 'scrollX', // 附件溢出时横向滚动
  },
  // 上传配置
  uploadProps: {
    accept: '.xlsx,.xls',
  },
  onFileSelect: (e: CustomEvent<File[]>) => {
    const raw = e.detail[0]
    const form = new FormData()
    form.append('file', raw as File)
    fetch('/api/files', {
      method: 'POST',
      body: form,
    })
      .then((res) => res.json())
      .then((data) => {
        filesList.value.push({
          name: raw.name,
          fileId: data.fileId,
        })
      })
      .catch((err) => {
        console.log('err', err)
      })
  },
}

const handleFileRemove = (item: any) => {
  filesList.value = filesList.value.filter(
    (file) => file.fileId !== item.detail!.fileId,
  )
}

const messages = ref<any[]>([])
/** 当前轮助手流式文本累积，用于写入 messages 供下一轮请求 */
const pendingAssistantText = ref('')

/**
 * 将后端 SSE 解析后的 chunk 转为 TDesign ChatEngine 可合并的 AIMessageContent。
 * 与文档中 SSEChunkData + onMessage 约定一致，参见 TDesign Chat 文档。
 */
const sseChunkToAiContent = (chunk: SSEChunkData): AIMessageContent | null => {
  if (chunk.event === 'error') {
    const raw = chunk.data
    const msg =
      typeof raw === 'string'
        ? raw
        : raw &&
            typeof raw === 'object' &&
            'message' in (raw as object) &&
            typeof (raw as { message?: unknown }).message === 'string'
          ? (raw as { message: string }).message
          : '请求失败'
    return { type: 'markdown', data: `**错误**：${msg}`, status: 'error' }
  }
  const d = chunk.data
  if (d && typeof d === 'object' && (d as { type?: unknown }).type === 'chart') {
    // 扩展类型：引擎以插槽渲染，需在下方 registerMergeStrategy('chart', ...)
    return d as AIMessageContent
  }
  if (
    d &&
    typeof d === 'object' &&
    (d as { type?: unknown }).type === 'markdown' &&
    typeof (d as { data?: unknown }).data === 'string'
  ) {
    return d as AIMessageContent
  }
  return null
}

const chatServiceConfig: ChatServiceConfig = {
  endpoint: '/api/chat/stream',
  stream: true,
  onRequest: (params: ChatRequestParams) => {
    messages.value.push({
      role: 'user',
      text: params.prompt ?? '',
    })

    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.value,
        fileId: filesList.value[0]?.fileId || undefined,
        /** 为 true 时流结束后服务端追加一条 type=chart 的 SSE，演示 ECharts 自定义渲染 */
        includeEchartDemo: true,
      }),
    }
  },
  /** 避免空 delta 过早进入 streaming（与引擎类型注释中的示例一致） */
  isValidChunk: (chunk: SSEChunkData) => {
    if (chunk.event === 'error') return true
    const d = chunk.data
    if (d && typeof d === 'object' && (d as { type?: unknown }).type === 'chart') {
      return true
    }
    if (d && typeof d === 'object' && typeof (d as { data?: unknown }).data === 'string') {
      return (d as { data: string }).data.length > 0
    }
    return false
  },
  onMessage: (chunk: SSEChunkData): AIMessageContent | null => {
    const content = sseChunkToAiContent(chunk)
    if (content?.type === 'markdown' && typeof content.data === 'string') {
      if (content.status === 'error') {
        pendingAssistantText.value = ''
      } else {
        pendingAssistantText.value += content.data
      }
    }
    // chart 块不参与纯文本 messages 累积
    return content
  },
  /** 流式结束时引擎只传 isAborted 与请求参数，无第三个 JSON result */
  onComplete: (aborted: boolean): void => {
    if (!aborted && pendingAssistantText.value) {
      messages.value.push({
        role: 'assistant',
        text: pendingAssistantText.value,
      })
    }
    pendingAssistantText.value = ''
  },
}
</script>

<style scoped>
.chat-page {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --border: 240 5.9% 90%;
  --ring: 240 5.9% 10%;
  box-sizing: border-box;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 1rem;
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
  background-color: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.chat-card {
  width: 100%;
  border-radius: 0.75rem;
  border: 1px solid hsl(var(--border) / 0.85);
  background-color: hsl(var(--card));
  color: hsl(var(--card-foreground));
  box-shadow:
    0 1px 2px hsl(240 5% 10% / 0.04),
    0 1px 3px hsl(240 5% 10% / 0.06);
}

.chat-header {
  flex-shrink: 0;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid hsl(var(--border));
  background-color: hsl(var(--card));
}

.chat-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.3;
  color: hsl(var(--foreground));
}

.chat-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: hsl(var(--muted-foreground));
}

.chat-bot-wrap {
  padding: 20px;
  height: calc(100vh - 150px);
  position: relative;
}

.files-list {
  position: absolute;
  bottom: 150px;
  width: 600px;
  max-width: 600px;
  z-index: 99;
}
</style>
