<!--
 * @Author: Andrew Q
 * @Date: 2026-07-19 13:30:40
 * @LastEditors: Andrew Q
 * @LastEditTime: 2026-07-22 11:16:00
 * @Description: list
-->
<template>
  <div class="list">
    <header class="list-header">
      <el-button class="create-button" @click="emit('create-conversation')">
        <span class="create-icon" aria-hidden="true">+</span>
        新建对话
      </el-button>

      <label class="search-field">
        <span class="search-icon" aria-hidden="true"></span>
        <input v-model="keyword" type="search" placeholder="搜索对话" aria-label="搜索对话" />
        <button
          v-if="keyword"
          class="clear-search"
          type="button"
          aria-label="清空搜索"
          @click="keyword = ''"
        >
          ×
        </button>
      </label>
    </header>

    <main class="list-main">
      <el-scrollbar>
        <div class="conversation-section">
          <div class="section-heading">
            <span>最近对话</span>
            <span>{{ filteredList.length }} 条</span>
          </div>

          <div v-if="filteredList.length" class="conversation-items">
            <button
              v-for="item in filteredList"
              :key="item.id"
              class="item"
              :class="{ 'is-active': item.id === props.activeId }"
              type="button"
              @click="emit('select', item.id)"
            >
              <span class="conversation-dot" aria-hidden="true"></span>
              <span class="title">{{ item.title }}</span>
            </button>
          </div>

          <div v-else class="empty-state">
            {{ props.list.length ? '未找到匹配的对话' : '暂无对话' }}
          </div>
        </div>
      </el-scrollbar>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

interface Conversation {
  id: string
  title: string
}

const props = defineProps<{
  list: Conversation[]
  activeId?: string
}>()

const emit = defineEmits<{
  'create-conversation': []
  select: [id: string]
}>()

const keyword = ref('')

const filteredList = computed(() => {
  const searchKeyword = keyword.value.trim().toLowerCase()

  if (!searchKeyword) {
    return props.list
  }

  return props.list.filter((item) => item.title.toLowerCase().includes(searchKeyword))
})
</script>

<style scoped>
.list {
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 12px 10px 10px;
  background: #ffffff;
}

.list-header {
  display: grid;
  gap: 10px;
  flex: none;
  padding-bottom: 12px;
  border-bottom: 1px solid #edf0f3;
}

.list :deep(.create-button) {
  width: 100%;
  height: 38px;
  margin: 0;
  border: 0;
  border-radius: 8px;
  background: #24272d;
  color: #ffffff;
  font-weight: 600;
  letter-spacing: 0.1px;
  box-shadow: none;
}

.list :deep(.create-button:hover),
.list :deep(.create-button:focus-visible) {
  border: 0;
  background: #121417;
  color: #ffffff;
}

.create-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  margin-right: 2px;
  font-size: 19px;
  font-weight: 300;
  line-height: 1;
}

.search-field {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #f5f6f8;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.search-field:focus-within {
  border-color: #cbd4f6;
  background: #ffffff;
}

.search-icon {
  position: relative;
  flex: none;
  width: 11px;
  height: 11px;
  margin-right: 9px;
  border: 1.5px solid #9aa1ad;
  border-radius: 50%;
  box-sizing: border-box;
}

.search-icon::after {
  position: absolute;
  right: -4px;
  bottom: -2px;
  width: 5px;
  height: 1.5px;
  border-radius: 1px;
  background: #9aa1ad;
  content: '';
  transform: rotate(45deg);
  transform-origin: left center;
}

.search-field input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #30343b;
  font: inherit;
  font-size: 12px;
}

.search-field input::placeholder {
  color: #a7adb8;
}

.clear-search {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #d9dde4;
  color: #ffffff;
  cursor: pointer;
  font-size: 14px;
  line-height: 14px;
}

.clear-search:hover {
  background: #afb6c2;
}

.list-main {
  min-height: 0;
  flex: 1;
  overflow: hidden;
  padding-top: 8px;
}

.conversation-section {
  padding: 0 2px;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  padding: 4px 6px 7px;
  color: #959ca8;
  font-size: 11px;
  line-height: 16px;
}

.item {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  padding: 9px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #363b44;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.item + .item {
  margin-top: 2px;
}

.item:hover {
  background: #f2f4f7;
}

.item:focus-visible {
  outline: 2px solid #9eaff3;
  outline-offset: -2px;
}

.item.is-active {
  background: #edf1ff;
  color: #3f5fc5;
  font-weight: 600;
}

.conversation-dot {
  flex: none;
  width: 4px;
  height: 4px;
  margin-right: 8px;
  border-radius: 50%;
  background: #c4c9d1;
}

.item.is-active .conversation-dot {
  background: #6d82dd;
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  padding: 16px 8px;
  color: #a4aab4;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
}
</style>
