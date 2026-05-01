<template>
  <Transition name="quote-bar">
    <div v-if="visible && quoteData" class="quote-question-bar">
      <div class="quote-bar-preview">
        <span class="quote-bar-icon">💬</span>
        <span class="quote-bar-text">{{ previewText }}</span>
      </div>
      <button class="quote-bar-btn" @click="$emit('open')">
        引用提问
      </button>
    </div>
  </Transition>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  visible: Boolean,
  quoteData: Object,
})
defineEmits(['open'])

const previewText = computed(() => {
  if (!props.quoteData) return ''
  const text = props.quoteData.text || ''
  return text.length > 60 ? text.slice(0, 60) + '…' : text
})
</script>

<style scoped>
.quote-question-bar {
  position: fixed;
  bottom: calc(56px + env(safe-area-inset-bottom, 0px));
  left: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: var(--shadow-md);
  z-index: 2400;
  max-width: 400px;
  margin: 0 auto;
}

.quote-bar-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.quote-bar-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.quote-bar-text {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quote-bar-btn {
  flex-shrink: 0;
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  background: var(--accent-color);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}

.quote-bar-btn:active {
  opacity: 0.8;
}

.quote-bar-enter-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.quote-bar-leave-active {
  transition: all 0.15s ease-in;
}

.quote-bar-enter-from,
.quote-bar-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
