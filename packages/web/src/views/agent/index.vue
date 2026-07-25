<!--
 * @Author: Andrew Q
 * @Date: 2026-07-17 18:36:06
 * @LastEditors: Andrew Q
 * @LastEditTime: 2026-07-22 11:17:21
 * @Description: ai-agent
-->
<template>
  <div class="agent">
    <el-splitter>
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
        <ChatPanel :key="conversationKey" @new-chat="createConversation" :skills="skills" />
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

const conversationKey = ref(0)
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
  conversationKey.value += 1
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
</style>
