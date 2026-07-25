<!--
 * @Author: Andrew Q
 * @Date: 2026-07-17 18:36:06
 * @LastEditors: Andrew Q
 * @LastEditTime: 2026-07-22 11:17:21
 * @Description: ai-agent
-->
<template>
  <div class="agent">
    <el-splitter class="agent-content">
      <!-- 对话列表 -->
      <el-splitter-panel size="160" :max="'30%'">
        <ConversationList
          :list="list"
          :active-id="activeId"
          @create-conversation="createConversation"
          @select="activeId = $event"
        />
      </el-splitter-panel>
      <!-- 中间聊天区域 -->
      <el-splitter-panel :min="400">
        <div class="chat-main">
          <div class="service-tabs" role="tablist" aria-label="Chat 服务">
            <button
              v-for="(service, index) in chatServices"
              :id="`service-tab-${service.id}`"
              :key="service.id"
              class="service-tab"
              :class="{ 'is-active': activeService === service.id }"
              type="button"
              role="tab"
              :aria-controls="`service-panel-${service.id}`"
              :aria-selected="activeService === service.id"
              :tabindex="activeService === service.id ? 0 : -1"
              @click="activeService = service.id"
              @keydown="handleServiceTabKeydown($event, index)"
            >
              {{ service.label }}
            </button>
          </div>

          <section
            v-for="service in chatServices"
            v-show="activeService === service.id"
            :id="`service-panel-${service.id}`"
            :key="service.id"
            class="chat-service-panel"
            role="tabpanel"
            :aria-labelledby="`service-tab-${service.id}`"
          >
            <ChatPanel
              :key="`${service.id}-${conversationKeys[service.id]}`"
              :service="service.id"
              :skills="skills"
            />
          </section>
        </div>
      </el-splitter-panel>
      <!-- 右侧渲染区域 默认隐藏 -->
      <el-splitter-panel v-if="showRenderArea" :max="300">
        <RenderPanel />
      </el-splitter-panel>
    </el-splitter>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref, shallowRef } from 'vue'
import type { AgentSkill } from '@data-agent/shared'

import { fetchAgentSkills } from './common/api'
import type { Conversation } from './common/type'

const ConversationList = defineAsyncComponent(() => import('./list/index.vue'))
const ChatPanel = defineAsyncComponent(() => import('./chat/index.vue'))
const RenderPanel = defineAsyncComponent(() => import('./render/index.vue'))

const chatServices = [
  { id: 'web-research', label: '联网研究' },
  { id: 'agent-stream', label: 'Agent·流式' },
  { id: 'agent-batch', label: 'Agent·非流式' },
] as const

type ChatService = (typeof chatServices)[number]['id']

const activeService = ref<ChatService>('agent-stream')
const conversationKeys = ref<Record<ChatService, number>>({
  'web-research': 0,
  'agent-stream': 0,
  'agent-batch': 0,
})
const showRenderArea = ref(false)

const list = ref<Conversation[]>([
  {
    id: '1',
    title: '对话1'
  },
  {
    id: '2',
    title: '对话2'
  },
  {
    id: '3',
    title: '对话3'
  }
])

const skills = shallowRef<AgentSkill[]>([])

const loadSkills = async () => {
  try {
    skills.value = await fetchAgentSkills()
  } catch (error) {
    console.error('加载 Skills 失败', error)
  }
}

onMounted(() => {
  void loadSkills()
})

const createConversation = () => {
  conversationKeys.value[activeService.value] += 1
}

const handleServiceTabKeydown = (event: KeyboardEvent, index: number) => {
  let nextIndex: number | undefined
  if (event.key === 'ArrowRight') nextIndex = (index + 1) % chatServices.length
  if (event.key === 'ArrowLeft') nextIndex = (index - 1 + chatServices.length) % chatServices.length
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = chatServices.length - 1
  if (nextIndex === undefined) return

  event.preventDefault()
  activeService.value = chatServices[nextIndex].id
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [nextIndex]?.focus()
  }
}

const activeId = ref('')
</script>

<style scoped>
.agent {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 1px solid #e7e7e7;
  border-radius: 8px;
}

.chat-main {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.service-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
  border-bottom: 1px solid #e7e7e7;
}

.service-tab {
  padding: 8px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  color: #606266;
  background: transparent;
  cursor: pointer;
}

.service-tab:hover,
.service-tab.is-active {
  color: #409eff;
}

.service-tab.is-active {
  border-bottom-color: #409eff;
}

.service-tab:focus-visible {
  outline: 2px solid #409eff;
  outline-offset: 2px;
}

.agent-content {
  height: 100%;
  min-height: 0;
}

.chat-service-panel {
  flex: 1;
  min-height: 0;
}
</style>
