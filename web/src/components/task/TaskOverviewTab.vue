<template>
  <div class="task-overview">
    <!-- Info card -->
    <div class="overview-card">
      <!-- Status -->
      <div class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.status') }}</span>
        <span class="overview-value">
          <span class="status-dot" :class="task.status"></span>
          <span :class="['status-text', task.status]">{{ statusText }}</span>
        </span>
      </div>
      <!-- Frequency -->
      <div class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.frequency') }}</span>
        <span class="overview-value">{{ humanizeCron(task.cronExpr) }}</span>
      </div>
      <!-- Agent -->
      <div class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.executor') }}</span>
        <span class="overview-value">
          <span class="agent-icon">{{ getAgentIcon(task.agentId) }}</span>
          <span class="agent-name">{{ getAgentName(task.agentId) }}</span>
        </span>
      </div>
      <!-- Repeat mode -->
      <div class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.repeat') }}</span>
        <span class="overview-value">{{ repeatLabel(task.repeatMode, task.maxRuns) }}</span>
      </div>
      <!-- Run count -->
      <div v-if="task.runCount > 0" class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.statusExecutions', { count: task.runCount }) }}</span>
      </div>
      <!-- Next run -->
      <div v-if="task.nextRunAt" class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.nextRun') }}</span>
        <span class="overview-value">{{ formatDateTime(task.nextRunAt) }}</span>
      </div>
    </div>

    <!-- Prompt preview card -->
    <div class="overview-card">
      <div class="prompt-header" @click="promptExpanded = !promptExpanded">
        <span class="overview-label">{{ t('task.form.prompt') }}</span>
        <span class="prompt-toggle">{{ promptExpanded ? '▾' : '▸' }}</span>
      </div>
      <div class="prompt-body" :class="{ collapsed: !promptExpanded }">
        <div class="prompt-content" v-html="renderedPrompt"></div>
        <div v-if="!promptExpanded" class="prompt-fade"></div>
      </div>
    </div>

    <!-- Action buttons -->
    <div class="overview-actions">
      <template v-if="task.status === 'active'">
        <button class="action-btn primary" :disabled="actionLoading" @click="triggerTask">
          {{ t('chat.contentBlocks.trigger') }}
        </button>
        <button class="action-btn" :disabled="actionLoading" @click="pauseTask">
          {{ t('chat.contentBlocks.pause') }}
        </button>
        <button class="action-btn danger" :disabled="actionLoading" @click="deleteTask">
          {{ t('chat.contentBlocks.delete') }}
        </button>
      </template>
      <template v-else-if="task.status === 'paused'">
        <button class="action-btn primary" :disabled="actionLoading" @click="triggerTask">
          {{ t('chat.contentBlocks.trigger') }}
        </button>
        <button class="action-btn" :disabled="actionLoading" @click="resumeTask">
          {{ t('chat.contentBlocks.resume') }}
        </button>
        <button class="action-btn danger" :disabled="actionLoading" @click="deleteTask">
          {{ t('chat.contentBlocks.delete') }}
        </button>
      </template>
      <template v-else-if="task.status === 'completed'">
        <button class="action-btn danger" :disabled="actionLoading" @click="deleteTask">
          {{ t('chat.contentBlocks.delete') }}
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTaskTab } from '@/composables/useTaskTab'
import { useDialog } from '@/composables/useDialog'
import { useMarkdownRenderer } from '@/composables/useMarkdownRenderer'
import { useAgents } from '@/composables/useAgents'
import { humanizeCron, repeatLabel, formatDateTime } from '@/utils/format'

const { t } = useI18n()
const { loadTasks } = useTaskTab()
const dialog = useDialog()
const { renderMarkdown } = useMarkdownRenderer()
const { getAgentIcon, getAgentName } = useAgents()

const props = defineProps<{
  task: any
}>()

const emit = defineEmits<{
  (e: 'deleted'): void
}>()

const actionLoading = ref(false)
const promptExpanded = ref(false)

const statusText = computed(() => {
  if (props.task.runningCount > 0) return t('chat.contentBlocks.statusRunning')
  const map: Record<string, string> = {
    active: t('chat.contentBlocks.statusActive'),
    paused: t('chat.contentBlocks.statusPaused'),
    completed: t('chat.contentBlocks.statusCompleted'),
  }
  return map[props.task.status] || props.task.status
})

const renderedPrompt = computed(() => {
  return renderMarkdown(props.task.prompt || '', { sanitize: true, wrapTables: false })
})

async function triggerTask() {
  actionLoading.value = true
  try {
    const resp = await fetch(`/api/tasks/${props.task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trigger' }),
    })
    if (resp.status === 409) {
      // Already running — ignore
    }
    await loadTasks()
  } catch (err) {
    console.error('Failed to trigger task:', err)
  } finally {
    actionLoading.value = false
  }
}

async function pauseTask() {
  actionLoading.value = true
  try {
    await fetch(`/api/tasks/${props.task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    })
    await loadTasks()
  } catch (err) {
    console.error('Failed to pause task:', err)
  } finally {
    actionLoading.value = false
  }
}

async function resumeTask() {
  actionLoading.value = true
  try {
    await fetch(`/api/tasks/${props.task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    })
    await loadTasks()
  } catch (err) {
    console.error('Failed to resume task:', err)
  } finally {
    actionLoading.value = false
  }
}

async function deleteTask() {
  if (!await dialog.confirm(t('task.confirmDelete'), { dangerous: true })) return
  actionLoading.value = true
  try {
    await fetch(`/api/tasks/${props.task.id}`, { method: 'DELETE' })
    await loadTasks()
    emit('deleted')
  } catch (err) {
    console.error('Failed to delete task:', err)
  } finally {
    actionLoading.value = false
  }
}
</script>

<style scoped>
.task-overview {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px;
}

.overview-card {
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.overview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 22px;
}

.overview-label {
  font-size: 12px;
  color: var(--text-muted, #999);
  flex-shrink: 0;
}

.overview-value {
  font-size: 13px;
  color: var(--text-primary, #1a1a1a);
  display: flex;
  align-items: center;
  gap: 5px;
  text-align: right;
  word-break: break-word;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.active {
  background: #22c55e;
}

.status-dot.paused {
  background: #eab308;
}

.status-dot.completed {
  background: var(--text-muted, #999);
}

.status-dot.running {
  background: #22c55e;
  animation: task-running-pulse 1.5s ease-in-out infinite;
}

@keyframes task-running-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  50% { opacity: 0.7; box-shadow: 0 0 6px 2px rgba(34, 197, 94, 0.2); }
}

.status-text.active {
  color: #22c55e;
}

.status-text.paused {
  color: #eab308;
}

.status-text.completed {
  color: var(--text-muted, #999);
}

.status-text.running {
  color: #22c55e;
}

.agent-icon {
  font-size: 14px;
}

.agent-name {
  font-size: 13px;
}

/* Prompt card */
.prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
}

.prompt-toggle {
  font-size: 12px;
  color: var(--text-muted, #999);
}

.prompt-body {
  position: relative;
  overflow: hidden;
}

.prompt-body.collapsed {
  max-height: 4.5em;
}

.prompt-content {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #666);
}

.prompt-content :deep(p) {
  margin: 0 0 4px;
}

.prompt-content :deep(p:last-child) {
  margin-bottom: 0;
}

.prompt-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2em;
  background: linear-gradient(transparent, var(--bg-secondary, #f5f5f5));
  pointer-events: none;
}

/* Action buttons */
.overview-actions {
  display: flex;
  gap: 8px;
  padding-top: 4px;
}

.action-btn {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 8px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1a1a1a);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (hover: hover) {
  .action-btn:hover:not(:disabled) {
    background: var(--bg-tertiary, rgba(0, 0, 0, 0.03));
  }
}

.action-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.action-btn.primary {
  background: var(--accent-color, #0066cc);
  color: #fff;
  border-color: var(--accent-color, #0066cc);
}

@media (hover: hover) {
  .action-btn.primary:hover:not(:disabled) {
    opacity: 0.9;
    background: var(--accent-color, #0066cc);
  }
}

.action-btn.danger {
  color: #dc3545;
  border-color: #dc3545;
}

@media (hover: hover) {
  .action-btn.danger:hover:not(:disabled) {
    background: rgba(220, 53, 69, 0.06);
  }
}
</style>
