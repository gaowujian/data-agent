<!--
  TDesign t-chat-item 对未知 AIMessageContent.type 会走具名插槽 `${type}-${index}`，
  t-chatbot 再映射为 `${messageId}-${type}-${index}`，本组件只负责根据 option 渲染 ECharts。
-->
<template>
  <div ref="hostEl" class="tdesign-chat-chart-slot" role="img" aria-label="图表" />
</template>

<script setup lang="ts">
import * as echarts from 'echarts'
import type { ECharts, EChartsCoreOption } from 'echarts'
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

const props = defineProps<{
  /** ECharts setOption 的配置对象 */
  option: EChartsCoreOption | Record<string, unknown> | undefined
}>()

const hostEl = ref<HTMLDivElement | null>(null)
const chartRef = shallowRef<ECharts | null>(null)

const disposeChart = () => {
  if (chartRef.value) {
    chartRef.value.dispose()
    chartRef.value = null
  }
}

const applyOption = (opt: EChartsCoreOption | Record<string, unknown> | undefined) => {
  if (!hostEl.value || !opt || typeof opt !== 'object') return
  if (!chartRef.value) {
    chartRef.value = echarts.init(hostEl.value, undefined, { renderer: 'canvas' })
  }
  try {
    chartRef.value.setOption(opt as EChartsCoreOption, { notMerge: true })
    // 固定宽高后需 resize，否则父级布局压缩后 canvas 仍按旧尺寸
    chartRef.value.resize()
  } catch (e) {
    console.error('[TdesignChatChartSlot] setOption 失败', e)
  }
}

onMounted(async () => {
  applyOption(props.option)
  await nextTick()
  chartRef.value?.resize()
})

watch(
  () => props.option,
  async (opt) => {
    applyOption(opt)
    await nextTick()
    chartRef.value?.resize()
  },
  { deep: true },
)

watch(hostEl, (el) => {
  if (el && props.option) {
    if (!chartRef.value) applyOption(props.option)
  }
})

onBeforeUnmount(() => {
  disposeChart()
})
</script>

<style scoped>
.tdesign-chat-chart-slot {
  box-sizing: border-box;
  width: 300px;
  height: 200px;
  max-width: 100%;
  flex-shrink: 0;
  margin: 0.5rem 0;
}
</style>
