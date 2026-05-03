<template>
  <div class="chat-message user pending">
    <!-- File attachments — same structure as ChatMessageItem -->
    <div v-if="hasFiles" class="chat-files">
      <template v-for="(f, idx) in allFiles" :key="idx">
        <span v-if="isUploadPath(normalizeFileEntry(f).path)" class="chat-file-attachment attachment-upload" title="上传附件">
          <svg v-if="isImageFile(normalizeFileEntry(f).path)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <circle cx="10" cy="13" r="2"/>
            <path d="m20 17-3.1-3.1a2 2 0 0 0-2.8 0L9 19"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span class="chat-file-name">{{ getFileName(normalizeFileEntry(f).path) }}</span>
        </span>
        <span v-else class="chat-file-attachment attachment-ref" title="文件引用">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
          <span class="chat-file-name">{{ getFileName(normalizeFileEntry(f).path) }}</span>
        </span>
      </template>
    </div>

    <span v-if="msg.text" class="pending-text">{{ msg.text }}</span>
    <span class="pending-hint">
      <span class="pending-spinner"></span>
      排队中
      <button class="pending-remove" @click="$emit('remove', index)" title="移除">×</button>
    </span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { baseName } from '@/utils/helpers.ts'

const props = defineProps({
  msg: Object,
  index: Number,
})
defineEmits(['remove'])

// Merge files from both msg.files (upload paths) and msg.filePaths (reference paths)
const allFiles = computed(() => {
  const files = []
  if (props.msg?.files?.length) files.push(...props.msg.files)
  if (props.msg?.filePaths?.length) {
    for (const p of props.msg.filePaths) {
      // Avoid duplicates if same path appears in both
      if (!files.includes(p)) files.push(p)
    }
  }
  return files
})

const hasFiles = computed(() => allFiles.value.length > 0)

function normalizeFileEntry(f) {
  if (typeof f === 'string') return { path: f }
  return { path: f.path || '' }
}

function isUploadPath(path) {
  return path.startsWith('.clawbench/uploads/') || path.startsWith('.clawbench\\uploads\\')
}

function isImageFile(path) {
  if (!path) return false
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif', '.avif']
  const lower = path.toLowerCase()
  return imageExts.some(ext => lower.endsWith(ext))
}

function getFileName(path) {
  return baseName(path)
}
</script>

<style scoped>
/* Reuse .chat-message.user styles — only override transparency and dashed border */
.chat-message.user.pending {
  opacity: 0.55;
  border: 1px dashed rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  animation: pending-fade-in 0.25s ease-out;
}

.pending-text {
  color: inherit;
  word-break: break-word;
  white-space: pre-wrap;
}

.pending-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.6);
  padding: 0 2px;
  font-size: 13px;
  line-height: 1;
  transition: color 0.15s;
}

.pending-remove:hover {
  color: rgba(255, 255, 255, 1);
}

.pending-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  flex-basis: 100%;
}

.pending-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid rgba(255, 255, 255, 0.3);
  border-top-color: rgba(255, 255, 255, 0.8);
  border-radius: 50%;
  animation: pending-spin 0.6s linear infinite;
}

@keyframes pending-spin {
  to { transform: rotate(360deg); }
}

@keyframes pending-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 0.55; transform: translateY(0); }
}
</style>
