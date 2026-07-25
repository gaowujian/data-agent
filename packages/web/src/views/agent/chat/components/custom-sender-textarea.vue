<template>
  <div class="prose-sender">
    <div ref="editorHost" class="custom-sender__editor" @mousedown="focusEditor" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { AgentSkill } from '@data-agent/shared'

export type SkillOption = AgentSkill

const props = withDefaults(
  defineProps<{
    placeholder?: string
    disabled?: boolean
  }>(),
  {
    placeholder: '',
    disabled: false
  }
)

const emit = defineEmits<{
  'input-change': [value: string]
  'mention-change': [payload: { isOpen: boolean; query: string }]
}>()

const editorHost = ref<HTMLElement>()
const editorView = shallowRef<EditorView>()
const mentionRange = ref<{ from: number; to: number }>()

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }]
    },
    text: { group: 'inline' },
    skill: {
      group: 'inline',
      inline: true,
      atom: true,
      selectable: true,
      attrs: {
        name: { default: '' },
        description: { default: '' }
      },
      toDOM: (node) => [
        'span',
        {
          class: 'custom-sender__skill',
          'data-skill-name': node.attrs.name,
          contenteditable: 'false'
        },
        `@${node.attrs.name}`
      ],
      parseDOM: [{ tag: 'span[data-skill-name]' }]
    }
  }
})

watch(
  () => props.placeholder,
  (placeholder) => {
    editorView.value?.dom.setAttribute('data-placeholder', placeholder)
  }
)

watch(
  () => props.disabled,
  () => {
    editorView.value?.setProps({ editable: () => !props.disabled })
  }
)

const getPlainText = (doc: ProseMirrorNode) => {
  let value = ''
  doc.forEach((paragraph, index) => {
    if (index) value += '\n'
    paragraph.forEach((node) => {
      if (node.isText) {
        value += node.text
        return
      }

      if (node.type.name === 'skill') value += `@${node.attrs.name}`
    })
  })
  return value
}

const closeMention = () => {
  const wasOpen = Boolean(mentionRange.value)
  mentionRange.value = undefined
  if (wasOpen) emit('mention-change', { isOpen: false, query: '' })
}

const updateMention = (state: EditorState) => {
  if (!state.selection.empty) {
    closeMention()
    return
  }

  // 用单字符占位 atom 节点，保证文本索引与 ProseMirror position 对齐。
  const beforeCursor = state.doc.textBetween(0, state.selection.from, '', '\uFFFC')
  const mention = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/u)
  if (!mention) {
    closeMention()
    return
  }

  const nextRange = {
    from: state.selection.from - mention[1].length - 1,
    to: state.selection.from
  }
  const queryChanged =
    mentionRange.value?.from !== nextRange.from || mentionRange.value?.to !== nextRange.to
  mentionRange.value = nextRange
  if (queryChanged) emit('mention-change', { isOpen: true, query: mention[1] })
}

const syncEditor = (state: EditorState) => {
  const view = editorView.value
  if (!view) return

  view.updateState(state)
  view.dom.classList.toggle('is-empty', !getPlainText(state.doc))
  updateMention(state)
}

const insertSkill = (skill: SkillOption) => {
  const view = editorView.value
  const range = mentionRange.value
  if (!view || !range) return

  const skillNode = schema.nodes.skill.create({
    name: skill.name,
    description: skill.description || ''
  })
  const transaction = view.state.tr
    .replaceWith(range.from, range.to, skillNode)
    .insertText(' ', range.from + skillNode.nodeSize)

  const nextSelection = range.from + skillNode.nodeSize + 1
  transaction.setSelection(TextSelection.create(transaction.doc, nextSelection))
  view.dispatch(transaction)
  view.focus()
}

const clearInput = () => {
  const view = editorView.value
  if (!view) return

  const transaction = view.state.tr.replaceWith(
    0,
    view.state.doc.content.size,
    schema.nodes.paragraph.create()
  )
  transaction.setSelection(TextSelection.create(transaction.doc, 1))
  view.dispatch(transaction)
}

const getSelectedSkillNames = (): string[] => {
  const names = new Set<string>()
  editorView.value?.state.doc.descendants((node) => {
    if (node.type.name !== 'skill' || typeof node.attrs.name !== 'string') return
    names.add(node.attrs.name)
  })
  return [...names]
}

const focusEditor = () => {
  editorView.value?.focus()
}

onMounted(() => {
  if (!editorHost.value) return

  editorView.value = new EditorView(editorHost.value, {
    state: EditorState.create({ schema }),
    editable: () => !props.disabled,
    attributes: {
      class: 'custom-sender__content',
      'data-placeholder': props.placeholder,
      role: 'textbox',
      'aria-multiline': 'true'
    },
    nodeViews: {
      skill: (node) => {
        const dom = document.createElement('span')
        dom.className = 'custom-sender__skill'
        dom.textContent = `@${node.attrs.name}`
        dom.contentEditable = 'false'
        dom.setAttribute('data-skill-name', node.attrs.name)
        dom.setAttribute('aria-label', `Skill: ${node.attrs.name}`)
        if (node.attrs.description) dom.title = node.attrs.description

        return { dom, ignoreMutation: () => true }
      }
    },
    dispatchTransaction: (transaction) => {
      const state = editorView.value?.state.apply(transaction)
      if (!state) return

      syncEditor(state)
      if (transaction.docChanged) emit('input-change', getPlainText(state.doc))
    },
  })
  editorView.value.dom.classList.toggle('is-empty', !getPlainText(editorView.value.state.doc))
})

onBeforeUnmount(() => {
  editorView.value?.destroy()
})

defineExpose({ insertSkill, closeMention, clearInput, getSelectedSkillNames })
</script>

<style scoped>
.prose-sender {
  position: relative;
  flex: 1;
  width: 100%;
  min-width: 0;
}

.custom-sender__editor {
  width: 100%;
  min-height: 64px;
}

.custom-sender__editor :deep(.custom-sender__content) {
  min-height: 64px;
  padding: 8px 0;
  color: #1f2329;
  line-height: 24px;
  cursor: text;
  white-space: pre-wrap;
  outline: none;
}

.custom-sender__editor :deep(.custom-sender__content.is-empty::before) {
  color: #a9aeb8;
  pointer-events: none;
  content: attr(data-placeholder);
}

.custom-sender__editor :deep(p) {
  min-height: 24px;
  margin: 0;
}

.custom-sender__editor :deep(.custom-sender__skill) {
  display: inline-block;
  padding: 0 8px;
  margin: 0 2px;
  color: #0052d9;
  line-height: 22px;
  vertical-align: baseline;
  background: #e8f3ff;
  border-radius: 4px;
}
</style>
