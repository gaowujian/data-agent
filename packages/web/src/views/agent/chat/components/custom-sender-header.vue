<template>
  <div
    v-show="isOpen"
    class="skill-menu"
    role="listbox"
    aria-label="Skills"
    :aria-hidden="!isOpen"
  >
    <!-- <div class="skill-menu__header">
      <span>Skills</span>
      <span class="skill-menu__query">
        {{ query ? `@${query}` : '选择 Skill' }}
      </span>
    </div> -->
    <div v-if="filteredSkills.length" class="skill-menu__list">
      <button
        v-for="(skill, index) in filteredSkills"
        :key="skill.name"
        type="button"
        class="skill-menu__item"
        :class="{ 'is-active': index === activeSkillIndex }"
        role="option"
        :aria-selected="index === activeSkillIndex"
        @mouseenter="activeSkillIndex = index"
        @mousedown.prevent
        @click="selectSkill(skill)"
      >
        <span class="skill-menu__icon"><MagicStick /></span>
        <span class="skill-menu__content">
          <span class="skill-menu__name">{{ skill.name }}</span>
          <span v-if="skill.description" class="skill-menu__description">
            {{ skill.description }}
          </span>
        </span>
      </button>
    </div>
    <div v-else class="skill-menu__empty">暂无可用 Skills</div>
    <div class="skill-menu__footer">
      <span>↑↓ 导航</span>
      <span>Enter 选择</span>
      <span>Esc 关闭</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MagicStick } from '@element-plus/icons-vue'
import type { AgentSkill } from '@data-agent/shared'

const props = withDefaults(
  defineProps<{
    skills?: AgentSkill[]
    isOpen?: boolean
    query?: string
  }>(),
  {
    skills: () => [],
    isOpen: false,
    query: ''
  }
)

const emit = defineEmits<{
  'skill-select': [skill: AgentSkill]
  'mention-close': []
}>()

const activeSkillIndex = ref(0)

const filteredSkills = computed(() => {
  const normalizedQuery = props.query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return props.skills

  return props.skills.filter((skill) => {
    const searchableText = `${skill.name} ${skill.description || ''}`.toLocaleLowerCase()
    return searchableText.includes(normalizedQuery)
  })
})

watch(filteredSkills, () => {
  activeSkillIndex.value = 0
})

const selectSkill = (skill: AgentSkill) => {
  emit('skill-select', skill)
}

const handleKeydown = (event: KeyboardEvent) => {
  if (!props.isOpen) return

  const skillCount = filteredSkills.value.length
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('mention-close')
    return
  }

  if (!skillCount) return

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    const offset = event.key === 'ArrowDown' ? 1 : -1
    activeSkillIndex.value = (activeSkillIndex.value + offset + skillCount) % skillCount
    return
  }

  if (event.key === 'Enter' || event.key === 'Tab') {
    const selectedSkill = filteredSkills.value[activeSkillIndex.value]
    if (!selectedSkill) return

    event.preventDefault()
    event.stopPropagation()
    selectSkill(selectedSkill)
  }
}

defineExpose({ handleKeydown })
</script>

<style scoped>
.skill-menu {
  width: min(560px, calc(100% - 24px));
  margin: 0 auto 8px;
  overflow: hidden;
  color: #1f2329;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}

.skill-menu__header,
.skill-menu__footer {
  display: flex;
  align-items: center;
  color: #86909c;
  font-size: 12px;
}

.skill-menu__header {
  justify-content: space-between;
  padding: 10px 12px 6px;
  color: #4e5969;
  font-weight: 600;
}

.skill-menu__query {
  max-width: 70%;
  overflow: hidden;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-menu__list {
  max-height: 240px;
  padding: 4px 6px;
  overflow-y: auto;
}

.skill-menu__item {
  display: flex;
  width: 100%;
  padding: 9px 8px;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;

  &.is-active,
  &:hover {
    background: #f2f3f5;
  }
}

.skill-menu__icon {
  display: flex;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-right: 8px;
  color: #165dff;
  background: #edf3ff;
  border-radius: 6px;

  svg {
    width: 16px;
    height: 16px;
  }
}

.skill-menu__content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
}

.skill-menu__name {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-menu__description {
  margin-top: 2px;
  overflow: hidden;
  color: #86909c;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-menu__empty {
  padding: 20px 12px;
  color: #86909c;
  text-align: center;
}

.skill-menu__footer {
  gap: 12px;
  padding: 7px 12px;
  border-top: 1px solid #f0f0f0;
}
</style>
