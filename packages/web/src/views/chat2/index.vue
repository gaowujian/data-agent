<!--
 * @Author: Andrew q
 * @Date: 2026-04-30 15:55:07
 * @LastEditors: Andrew q
 * @LastEditTime: 2026-04-30 18:09:15
 * @Description: chat2
-->
<template>
  <div class="chat-page">
    <section class="chat-card" aria-label="流式对话">
      <header class="chat-header">
        <h1 class="chat-title">Data Agent</h1>
        <p class="chat-subtitle">TDesign Chatbot · 流式 SSE</p>
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
          ref="chatRef"
          :chat-service-config="chatServiceConfig"
          :message-props="messageProps"
          :list-props="listProps"
          :sender-props="senderProps"
          @message-change="handleMessageChange"
        >
          <template v-for="msg in messages" :key="msg.id">
            <template
              v-for="(item, index) in msg.content"
              :key="`${msg.id}-${item.type}-${index}`"
            >
              <div
                v-if="item.type === 'chart'"
                :slot="`${msg.id}-${item.type}-${index}`"
                style="width: 600px; height: 400px"
              >
                <TvisionTcharts
                  class="chart"
                  :chart-type="item.data.chartType"
                  :options="item.data.options"
                  :theme="item.data.theme"
                />
              </div>
            </template>
          </template>
        </t-chatbot>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type {
  AIMessageContent,
  ChatRequestParams,
  ChatServiceConfig,
  TdChatSenderActionName,
  SSEChunkData,
  AIContentChunkUpdate,
  ChatMessagesData,
  TdChatMessageConfig,
} from '@tdesign-vue-next/chat'
import TvisionTcharts from 'tvision-charts-vue-next'
import { generateNanoId } from '@/utils/nanoId'

const listProps = {
  autoScroll: true,
  defaultScrollTo: 'bottom' as const,
}
const messageProps: TdChatMessageConfig = {
  user: {
    variant: 'base',
    placement: 'right',
  },
  assistant: {
    placement: 'left',
    chatContentProps: {
      thinking: {
        maxHeight: 100,
      },
    },
  },
};

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
const chatServiceConfig: ChatServiceConfig = {
  // endpoint: '/api/chat',
  // stream: false,
  // onRequest: (params: ChatRequestParams) => {
  //   messages.value.push({
  //     role: 'user',
  //     text: params.prompt ?? '',
  //   })

  //   return {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({
  //       messages: messages.value,
  //       fileId: filesList.value[0]?.fileId || undefined,
  //     }),
  //   }
  // },
  endpoint: `https://1257786608-9i9j1kpa67.ap-guangzhou.tencentscf.com/sse/normal`,
  stream: true,
  onRequest: (innerParams: ChatRequestParams) => {
    const { prompt } = innerParams;
    return {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        uid: 'test',
        prompt,
        chart: true,
      }),
    };
  },
  // 流式消息输出时的回调
  onMessage: (chunk: SSEChunkData): AIContentChunkUpdate => {
    const { type, ...rest } = chunk.data as any;
    switch (type) {
      // 正文
      case 'text':
        return {
          type: 'markdown',
          data: rest?.msg || '',
          // 根据后端返回的paragraph字段来决定是否需要另起一段展示markdown
          strategy: rest?.paragraph === 'next' ? 'append' : 'merge',
        }
      // 3、自定义渲染图表所需的数据结构
      case 'chart':
        return {
          type: 'chart',
          data: {
            id: generateNanoId(),
            ...chunk.data.content,
          },
          // 图表每次出现都是追加创建新的内容块
          strategy: 'append',
        }
      default:
        return {
          type: 'markdown',
          data: rest?.msg || '',
        }
    }
  },
  onComplete: (_aborted, _params, result): AIMessageContent | undefined => {
    // if (!result || typeof result !== 'object') return undefined
    // const r = result as { text?: string; error?: string }
    // if (typeof r.error === 'string' && r.error.trim()) {
    //   return { type: 'markdown', data: `**错误**：${r.error}` }
    // }
    // messages.value.push({
    //   role: 'assistant',
    //   text: r.text ?? '',
    // })
    // return { type: 'markdown', data: r.text ?? '' }
    console.log('onComplete', _aborted, _params, result);
  },
}

const chatRef = ref<any>(null)
// 消息变更处理
const handleMessageChange = (e: CustomEvent<ChatMessagesData[]>) => {
  messages.value = e.detail;
  console.log(messages.value);

  // 如果最后一条消息状态变为complete，强制更新视图
  if (messages.value.length > 0) {
    const lastMessage = messages.value[messages.value.length - 1];
    if (lastMessage.role === 'assistant' && lastMessage.status === 'complete') {
      console.log('update');
      // 使用setTimeout确保所有DOM更新完成
      setTimeout(() => {
        // 强制更新组件
        console.log(chatRef.value, 'chatRef.value');

        chatRef.value?.$forceUpdate?.();
      }, 0);
    }
  }
};
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

.chart {
  width: 600px;
  height: 400px;
}
</style>
