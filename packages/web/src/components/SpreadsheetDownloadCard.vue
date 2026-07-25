<template>
  <article class="download-card">
    <div class="download-meta">
      <strong>{{ artifact.fileName }}</strong>
      <span>修改版本 v{{ artifact.version }}</span>
    </div>
    <a class="download-link" :href="artifact.downloadUrl" download>下载 XLSX</a>
  </article>
</template>

<script setup lang="ts">
import type { DownloadArtifact } from '@data-agent/shared'

defineProps<{ artifact: DownloadArtifact }>()
</script>

<style scoped>
.download-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  max-width: 32rem;
  padding: 0.875rem 1rem;
  border: 1px solid #d9e1f2;
  border-radius: 0.625rem;
  background: #f7f9ff;
}

.download-meta {
  display: grid;
  min-width: 0;
  gap: 0.25rem;
}

.download-meta strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-meta span {
  color: #667085;
  font-size: 0.75rem;
}

.download-link {
  flex: none;
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  background: #0052d9;
  color: #fff;
  font-size: 0.8125rem;
  text-decoration: none;
}
</style>
