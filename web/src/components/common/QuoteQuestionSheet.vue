<template>
  <BottomSheet
    :open="open"
    title="引用提问"
    compact
    @close="$emit('close')"
  >
    <!-- Session selector -->
    <div class="qq-session" @click="showSessionPicker = true">
      <span class="qq-session-icon">{{ sessionIcon }}</span>
      <span class="qq-session-name">{{ sessionName }}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>

    <!-- Quote preview -->
    <div v-if="quoteData" class="qq-quote-preview">
      <div class="qq-quote-label">引用内容</div>
      <pre class="qq-quote-code"><code>{{ formatQuote() }}</code></pre>
    </div>

    <!-- Input -->
    <div class="qq-input-area">
      <textarea
        ref="inputRef"
        v-model="inputText"
        class="qq-input"
        rows="3"
        placeholder="输入你的问题..."
        @keydown.enter.meta="handleSend"
        @keydown.enter.ctrl="handleSend"
      />
      <button class="qq-send-btn" :disabled="!canSend" @click="handleSend">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>

    <template #footer>
      <div class="qq-footer-safe" />
    </template>
  </BottomSheet>

  <!-- Session picker overlay -->
  <Teleport to="body">
    <div v-if="showSessionPicker" class="qq-picker-overlay" @click="showSessionPicker = false">
      <div class="qq-picker" @click.stop>
        <div class="qq-picker-header">选择会话</div>
        <div class="qq-picker-list">
          <div v-if="loadingSessions" class="qq-picker-empty">加载中...</div>
          <div v-else-if="sessions.length === 0" class="qq-picker-empty">暂无会话</div>
          <div
            v-for="s in sessions"
            :key="s.id"
            class="qq-picker-item"
            :class="{ active: s.id === selectedSessionId }"
            @click="pickSession(s.id)"
          >
            <span class="qq-picker-item-title">{{ s.title || '新会话' }}</span>
            <span class="qq-picker-item-time">{{ formatTime(s.updatedAt) }}</span>
          </div>
        </div>
        <div class="qq-picker-footer">
          <button class="qq-picker-create" @click="createAndPick">+ 新会话</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import BottomSheet from '@/components/common/BottomSheet.vue'

const props = defineProps({
  open: Boolean,
  quoteData: Object,
  sessionIcon: { type: String, default: '🤖' },
  sessionName: { type: String, default: 'AI 对话' },
  currentSessionId: { type: String, default: '' },
})
const emit = defineEmits(['close', 'send'])

const inputText = ref('')
const inputRef = ref(null)
const showSessionPicker = ref(false)
const sessions = ref([])
const loadingSessions = ref(false)
const selectedSessionId = ref('')

const canSend = computed(() => inputText.value.trim().length > 0)

// Sync selected session with prop
watch(() => props.currentSessionId, (id) => {
  if (!selectedSessionId.value) selectedSessionId.value = id
}, { immediate: true })

// Load sessions when picker opens
watch(showSessionPicker, async (val) => {
  if (val) {
    loadingSessions.value = true
    try {
      const resp = await fetch('/api/ai/sessions')
      const data = await resp.json()
      sessions.value = data.sessions || []
    } catch (err) {
      sessions.value = []
    } finally {
      loadingSessions.value = false
    }
  }
})

// Focus input when sheet opens
watch(() => props.open, async (val) => {
  if (val) {
    selectedSessionId.value = props.currentSessionId
    await nextTick()
    inputRef.value?.focus()
  } else {
    inputText.value = ''
    showSessionPicker.value = false
  }
})

function formatQuote() {
  if (!props.quoteData) return ''
  const q = props.quoteData
  let langPrefix = q.language ? `${q.language}:` : ':'
  let lineSuffix = ''
  if (q.startLine && q.endLine && q.startLine !== q.endLine) {
    lineSuffix = `:${q.startLine}-${q.endLine}`
  } else if (q.startLine) {
    lineSuffix = `:${q.startLine}`
  }
  return `\`\`\`${langPrefix}${q.filePath}${lineSuffix}\n${q.text}\n\`\`\``
}

async function createAndPick() {
  try {
    const resp = await fetch('/api/ai/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await resp.json()
    if (data.ok && data.sessionId) {
      selectedSessionId.value = data.sessionId
      showSessionPicker.value = false
      emit('send', inputText.value, data.sessionId)
    }
  } catch (err) {
    console.error('Failed to create session:', err)
  }
}

function pickSession(sessionId) {
  selectedSessionId.value = sessionId
  showSessionPicker.value = false
}

function handleSend() {
  if (!canSend.value) return
  emit('send', inputText.value, selectedSessionId.value || undefined)
}

function formatTime(date) {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()
  const diff = now - d
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return d.toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.qq-session {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin: 4px 0;
  background: var(--bg-tertiary);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.qq-session:active {
  background: var(--bg-secondary);
}

.qq-session-icon {
  font-size: 14px;
}

.qq-session-name {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qq-quote-preview {
  margin: 8px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.qq-quote-label {
  font-size: 11px;
  color: var(--text-muted);
  padding: 4px 10px;
  background: var(--bg-tertiary);
}

.qq-quote-code {
  margin: 0;
  padding: 8px 10px;
  background: var(--code-bg);
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}

.qq-quote-code code {
  white-space: pre-wrap;
  word-break: break-all;
}

.qq-input-area {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px 0;
}

.qq-input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  resize: none;
  min-height: 72px;
  outline: none;
  font-family: inherit;
}

.qq-input:focus {
  border-color: var(--accent-color);
}

.qq-send-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: var(--accent-color);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s;
}

.qq-send-btn:active {
  opacity: 0.8;
}

.qq-send-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.qq-footer-safe {
  height: env(safe-area-inset-bottom, 0px);
}

/* Session picker */
.qq-picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 3000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.qq-picker {
  width: 100%;
  max-width: 400px;
  max-height: 60vh;
  background: var(--bg-primary);
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  animation: qq-picker-up 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes qq-picker-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.qq-picker-header {
  padding: 14px 16px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
}

.qq-picker-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.qq-picker-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
}

.qq-picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.qq-picker-item:active {
  background: var(--bg-tertiary);
}

.qq-picker-item.active {
  background: var(--accent-bg, rgba(0, 102, 204, 0.1));
}

.qq-picker-item-title {
  flex: 1;
  font-size: 14px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qq-picker-item.active .qq-picker-item-title {
  color: var(--accent-color);
  font-weight: 500;
}

.qq-picker-item-time {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  margin-left: 8px;
}

.qq-picker-footer {
  padding: 10px 12px;
  border-top: 1px solid var(--border-color);
}

.qq-picker-create {
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: var(--accent-color);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.qq-picker-create:active {
  opacity: 0.85;
}
</style>
