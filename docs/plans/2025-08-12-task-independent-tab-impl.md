# 定时任务独立 Tab 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将定时任务模块从聊天模块中拆分为独立的底部导航 Tab 页，支持三级导航（列表→详情→执行详情）。

**Architecture:** 新建 `useTaskTab` composable 管理导航状态和轮询逻辑，新建 6 个 Vue 组件（TaskTab、TaskListPage、TaskDetailPage、TaskOverviewTab、TaskHistoryTab、TaskExecDetail），修改 TaskFormDialog 传递新任务 ID，删除 TaskDrawer 和 TaskExecDialog。聊天中的 `<scheduled-task>` 卡片简化为"查看详情"跳转按钮。

**Tech Stack:** Vue 3 Composition API, TypeScript, lucide-vue-next, vue-i18n

**已知评审修复项（已纳入计划）：**
- TaskFormDialog `emit('saved')` 不传参数 → 修改为 `emit('saved', taskId)`，submit() 中解析 POST 响应获取新任务 ID
- ChatMetadataModal props 为 `:show`/`:data`/`:formatDetailTime`，非 `:open`/`:metadata`
- `useChatRender()` 必须传 `options` 参数，TaskExecDetail 和 TaskHistoryTab 中需提供 `{ messages: ref([]), theme, currentSessionId: ref('') }`
- TaskTab.vue 用 `v-show` 而非 `v-if` 以保留导航状态
- selectedTaskData 直接从 `store.state.tasks` 查找，而非从子组件 ref
- 文件打开走 `store.selectFile(path)` + `switchTab('viewer')`，不使用 window CustomEvent
- ChatMessageItem.vue 和 ChatMessageList.vue 需更新 defineEmits 和事件绑定

---

### Task 1: 创建 useTaskTab.ts composable

**Files:**
- Create: `web/src/composables/useTaskTab.ts`

**Step 1: 创建 useTaskTab.ts**

```typescript
import { ref, reactive } from 'vue'
import { store } from '@/stores/app.ts'

// Module-level singleton state
const currentView = ref<'list' | 'detail'>('list')
const selectedTaskId = ref<string | null>(null)
const selectedExecId = ref<string | null>(null)
const detailSubTab = ref<'overview' | 'history'>('overview')
const execDetailOpen = ref(false)

let taskPollingTimer: ReturnType<typeof setInterval> | null = null

export function useTaskTab() {
  function navigateToTask(taskId: string) {
    selectedTaskId.value = taskId
    currentView.value = 'detail'
    detailSubTab.value = 'overview'
    execDetailOpen.value = false
    selectedExecId.value = null
  }

  function goBack() {
    if (execDetailOpen.value) {
      execDetailOpen.value = false
      selectedExecId.value = null
      return
    }
    currentView.value = 'list'
    selectedTaskId.value = null
    selectedExecId.value = null
    detailSubTab.value = 'overview'
  }

  function openExecDetail(execId: string) {
    selectedExecId.value = execId
    execDetailOpen.value = true
  }

  function closeExecDetail() {
    execDetailOpen.value = false
    selectedExecId.value = null
  }

  async function loadTasks() {
    try {
      const resp = await fetch('/api/tasks')
      if (!resp.ok) return
      const data = await resp.json()
      store.state.taskUnread = !!data.hasUnread
      const newTasks = data.tasks || []
      if (store.state.tasks.length !== newTasks.length ||
          newTasks.some((t: any, i: number) =>
            t.id !== store.state.tasks[i]?.id ||
            t.status !== store.state.tasks[i]?.status ||
            t.runCount !== store.state.tasks[i]?.runCount)) {
        store.state.tasks = newTasks
      }
    } catch (err) {
      console.error('Failed to load tasks:', err)
    }
  }

  async function markAllTasksRead() {
    const unreadTasks = (store.state.tasks || []).filter((t: any) => t.unreadCount > 0)
    if (unreadTasks.length === 0) return
    await Promise.all(unreadTasks.map((t: any) =>
      fetch(`/api/tasks/${t.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read' }),
      }).catch(() => {})
    ))
    store.state.taskUnread = false
  }

  function startTaskPolling() {
    if (taskPollingTimer) return
    loadTasks() // initial load
    taskPollingTimer = setInterval(loadTasks, 2000)
  }

  function stopTaskPolling() {
    if (taskPollingTimer) {
      clearInterval(taskPollingTimer)
      taskPollingTimer = null
    }
  }

  return {
    // Navigation state (module-level singleton)
    currentView,
    selectedTaskId,
    selectedExecId,
    detailSubTab,
    execDetailOpen,
    // Navigation methods
    navigateToTask,
    goBack,
    openExecDetail,
    closeExecDetail,
    // Data methods
    loadTasks,
    markAllTasksRead,
    // Polling
    startTaskPolling,
    stopTaskPolling,
  }
}
```

**Step 2: 验证文件创建成功**

Run: `ls -la web/src/composables/useTaskTab.ts`
Expected: 文件存在

**Step 3: Commit**

```bash
git add web/src/composables/useTaskTab.ts
git commit -m "feat(task-tab): add useTaskTab composable for navigation state and polling"
```

---

### Task 2: 创建 TaskListPage.vue

**Files:**
- Create: `web/src/components/task/TaskListPage.vue`

**Step 1: 创建 TaskListPage.vue**

从 TaskDrawer.vue 迁移列表渲染逻辑，改为全屏布局（不再用 BottomSheet）。

```vue
<template>
  <div class="task-list-page">
    <div class="task-list-header">
      <h2 class="task-list-title">
        <Clock :size="18" />
        {{ t('task.title') }}
      </h2>
      <button class="create-btn" @click="$emit('create')" :title="t('task.form.createTitle')">
        <Plus :size="18" />
      </button>
    </div>

    <div class="task-list-body">
      <div v-if="loading" class="task-loading">{{ t('common.loading') }}</div>
      <div v-else-if="tasks.length === 0" class="task-empty">{{ t('task.noTasks') }}</div>
      <div v-for="task in tasks" :key="task.id" class="task-item" :class="[task.status, { 'has-unread': task.unreadCount > 0 }]" @click="$emit('select', task.id)">
        <div class="task-item-info">
          <div class="task-item-header">
            <span class="task-item-icon">{{ getAgentIcon(task.agentId) }}</span>
            <span class="task-item-name">{{ task.name }}</span>
            <span v-if="task.runningCount > 0" class="task-item-running-dot" :title="t('task.exec.running')"></span>
            <span v-if="task.unreadCount > 0" class="task-item-unread">{{ task.unreadCount }}</span>
            <span class="task-item-status" :class="task.status">{{ statusLabel(task.status) }}</span>
          </div>
          <div class="task-item-meta">
            <span class="task-item-cron">{{ humanizeCron(task.cronExpr) }}</span>
            <span class="task-item-repeat">{{ repeatLabel(task.repeatMode, task.maxRuns) }}</span>
            <span v-if="task.repeatMode !== 'unlimited'" class="task-item-progress">{{ task.runCount }}/{{ task.maxRuns || 1 }}</span>
          </div>
          <div v-if="task.nextRunAt" class="task-item-next">
            {{ t('task.nextRun', { time: formatDateTime(task.nextRunAt) }) }}
          </div>
        </div>
        <ChevronRight :size="16" class="task-item-chevron" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { Clock, Plus, ChevronRight } from 'lucide-vue-next'
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAgents } from '@/composables/useAgents.ts'
import { useTaskTab } from '@/composables/useTaskTab.ts'
import { humanizeCron, repeatLabel, statusLabel, formatDateTime } from '@/utils/format.ts'
import { store } from '@/stores/app.ts'

const { t } = useI18n()
const { loadTasks, markAllTasksRead } = useTaskTab()
const { agents, loadAgents, getAgentIcon } = useAgents()

defineEmits(['create', 'select'])

const tasks = computed(() => store.state.tasks)
const loading = ref(false)

async function refresh() {
  loading.value = true
  try {
    await Promise.all([loadTasks(), loadAgents()])
    markAllTasksRead()
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

defineExpose({ refresh })
</script>

<style scoped>
.task-list-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.task-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e5e5e5);
  flex-shrink: 0;
}

.task-list-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #1a1a1a);
}

.create-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: var(--accent-color, #0066cc);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background 0.15s, transform 0.1s;
}

.create-btn:hover {
  background: var(--accent-hover, #0052a3);
}

.create-btn:active {
  transform: scale(0.92);
}

.task-list-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.task-loading,
.task-empty {
  padding: 48px 16px;
  text-align: center;
  color: var(--text-muted, #999);
  font-size: 14px;
}

.task-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.15s;
  gap: 8px;
}

.task-item.completed {
  opacity: 0.5;
}

@media (hover: hover) {
  .task-item:hover {
    background: var(--bg-tertiary, rgba(0, 0, 0, 0.03));
  }
}

.task-item:active {
  background: var(--bg-tertiary, rgba(0, 0, 0, 0.06));
}

.task-item:not(:last-child) {
  border-bottom: 1px solid var(--border-color, #e5e5e5);
}

.task-item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.task-item-header {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.task-item-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.task-item-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #1a1a1a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.task-item-unread {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 8px;
  font-weight: 600;
  background: #ef4444;
  color: #fff;
  flex-shrink: 0;
  min-width: 14px;
  text-align: center;
  line-height: 1.3;
}

.task-item.has-unread .task-item-icon {
  animation: task-unread-flash 0.8s ease-in-out infinite;
}

@keyframes task-unread-flash {
  0%, 100% { opacity: 1; text-shadow: 0 0 0 transparent; }
  50% { opacity: 0.7; text-shadow: 0 0 8px color-mix(in srgb, var(--accent-color, #0066cc) 40%, transparent); }
}

.task-item-status {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 500;
  flex-shrink: 0;
  line-height: 1.4;
}

.task-item-status.active { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
.task-item-status.paused { background: rgba(234, 179, 8, 0.12); color: #eab308; }
.task-item-status.completed { background: var(--bg-tertiary, #e9ecef); color: var(--text-muted, #999); }

.task-item-running-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success-color, #22c55e);
  flex-shrink: 0;
  animation: task-running-pulse 1.5s ease-in-out infinite;
}

@keyframes task-running-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  50% { opacity: 0.7; box-shadow: 0 0 6px 2px rgba(34, 197, 94, 0.2); }
}

.task-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted, #999);
  min-width: 0;
  overflow: hidden;
  flex-wrap: wrap;
}

.task-item-cron {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}

.task-item-next {
  font-size: 11px;
  color: var(--text-muted, #999);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-item-progress {
  font-weight: 500;
  color: var(--accent-color, #0066cc);
  flex-shrink: 0;
}

.task-item-chevron {
  color: var(--text-muted, #ccc);
  flex-shrink: 0;
}
</style>
```

**Step 2: 验证文件创建成功**

Run: `ls -la web/src/components/task/TaskListPage.vue`
Expected: 文件存在

**Step 3: Commit**

```bash
git add web/src/components/task/TaskListPage.vue
git commit -m "feat(task-tab): add TaskListPage component for Level 1 task list"
```

---

### Task 3: 创建 TaskOverviewTab.vue

**Files:**
- Create: `web/src/components/task/TaskOverviewTab.vue`

**Step 1: 创建 TaskOverviewTab.vue**

从 TaskDrawer 和 ChatPanel 的 handleTaskAction 逻辑组合。

```vue
<template>
  <div class="task-overview" v-if="task">
    <!-- Info card -->
    <div class="overview-card">
      <div class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.status') }}</span>
        <span class="overview-value">
          <span class="stask-status-dot" :class="statusDotClass"></span>
          {{ statusText }}
        </span>
      </div>
      <div class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.frequency') }}</span>
        <span class="overview-value">{{ humanizeCron(task.cronExpr) }}</span>
      </div>
      <div class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.executor') }}</span>
        <span class="overview-value">{{ getAgentIcon(task.agentId) }} {{ getAgentName(task.agentId) }}</span>
      </div>
      <div class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.repeat') }}</span>
        <span class="overview-value">{{ repeatLabel(task.repeatMode, task.maxRuns) }}</span>
      </div>
      <div v-if="task.runCount > 0" class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.statusExecutions', { count: task.runCount }) }}</span>
      </div>
      <div v-if="task.nextRunAt" class="overview-row">
        <span class="overview-label">{{ t('chat.contentBlocks.nextRun') }}</span>
        <span class="overview-value">{{ formatTime(task.nextRunAt) }}</span>
      </div>
    </div>

    <!-- Prompt preview -->
    <div class="overview-card">
      <div class="overview-card-header" @click="promptExpanded = !promptExpanded">
        <span class="overview-label">{{ t('task.form.prompt') }}</span>
        <ChevronDown :size="14" class="expand-icon" :class="{ expanded: promptExpanded }" />
      </div>
      <div class="prompt-preview" :class="{ collapsed: !promptExpanded }" v-html="renderedPrompt"></div>
    </div>

    <!-- Action buttons -->
    <div class="overview-actions">
      <button v-if="task.status === 'active' || task.status === 'paused'" class="action-btn primary" @click="triggerTask" :disabled="actionLoading">
        <Play :size="14" />
        {{ t('chat.contentBlocks.trigger') }}
      </button>
      <button v-if="task.status === 'active'" class="action-btn" @click="pauseTask" :disabled="actionLoading">
        <Pause :size="14" />
        {{ t('chat.contentBlocks.pause') }}
      </button>
      <button v-if="task.status === 'paused'" class="action-btn" @click="resumeTask" :disabled="actionLoading">
        <Play :size="14" />
        {{ t('chat.contentBlocks.resume') }}
      </button>
      <button class="action-btn danger" @click="deleteTask" :disabled="actionLoading">
        <Trash2 :size="14" />
        {{ t('chat.contentBlocks.delete') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Play, Pause, Trash2, ChevronDown } from 'lucide-vue-next'
import { useAgents } from '@/composables/useAgents.ts'
import { useDialog } from '@/composables/useDialog.ts'
import { useTaskTab } from '@/composables/useTaskTab.ts'
import { humanizeCron, repeatLabel, formatDateTime } from '@/utils/format.ts'
import { useMarkdownRenderer } from '@/composables/useMarkdownRenderer.ts'

const { t } = useI18n()
const dialog = useDialog()
const { loadTasks } = useTaskTab()
const { getAgentIcon, getAgentName } = useAgents()
const { renderMarkdown } = useMarkdownRenderer()

const props = defineProps({
  task: Object,
})

const emit = defineEmits(['deleted'])

const actionLoading = ref(false)
const promptExpanded = ref(false)

const statusDotClass = computed(() => {
  if (!props.task) return ''
  if (props.task.status === 'active') return 'status-active'
  if (props.task.status === 'paused') return 'status-paused'
  if (props.task.status === 'completed') return 'status-completed'
  return ''
})

const statusText = computed(() => {
  if (!props.task) return ''
  if (props.task.status === 'active') {
    const execLabel = t('chat.contentBlocks.statusExecutions', { count: props.task.runCount })
    if (props.task.runningCount > 0) return `${t('chat.contentBlocks.statusRunning')} (${execLabel})`
    return `${t('chat.contentBlocks.statusActive')} (${execLabel})`
  }
  if (props.task.status === 'paused') return t('chat.contentBlocks.statusPaused')
  if (props.task.status === 'completed') return t('chat.contentBlocks.statusCompleted')
  return props.task.status
})

const renderedPrompt = computed(() => {
  if (!props.task?.prompt) return ''
  return renderMarkdown(props.task.prompt)
})

function formatTime(iso) {
  if (!iso) return ''
  return formatDateTime(iso)
}

async function triggerTask() {
  actionLoading.value = true
  try {
    const resp = await fetch(`/api/tasks/${props.task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trigger' }),
    })
    if (resp.status === 409) {
      // Already running
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
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.overview-card {
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 8px;
  padding: 12px 16px;
}

.overview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13px;
  gap: 8px;
}

.overview-row:not(:last-child) {
  border-bottom: 1px solid var(--border-color, #e5e5e5);
}

.overview-label {
  color: var(--text-muted, #999);
  flex-shrink: 0;
}

.overview-value {
  color: var(--text-primary, #1a1a1a);
  text-align: right;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.stask-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stask-status-dot.status-active { background: #22c55e; }
.stask-status-dot.status-paused { background: #eab308; }
.stask-status-dot.status-completed { background: var(--text-muted, #999); }

.overview-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  padding: 4px 0;
}

.expand-icon {
  transition: transform 0.2s;
  color: var(--text-muted, #999);
}

.expand-icon.expanded {
  transform: rotate(180deg);
}

.prompt-preview {
  font-size: 13px;
  color: var(--text-secondary, #666);
  line-height: 1.5;
  overflow: hidden;
  transition: max-height 0.2s;
}

.prompt-preview.collapsed {
  max-height: 4.5em;
  position: relative;
}

.prompt-preview.collapsed::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2em;
  background: linear-gradient(transparent, var(--bg-secondary, #f5f5f5));
}

.overview-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1a1a1a);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn:hover {
  background: var(--bg-tertiary, #f0f0f0);
}

.action-btn:active {
  transform: scale(0.97);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.primary {
  background: var(--accent-color, #0066cc);
  color: #fff;
  border-color: var(--accent-color, #0066cc);
}

.action-btn.primary:hover {
  background: var(--accent-hover, #0052a3);
}

.action-btn.danger {
  color: #dc3545;
  border-color: rgba(220, 53, 69, 0.3);
}

.action-btn.danger:hover {
  background: rgba(220, 53, 69, 0.08);
}
</style>
```

**Step 2: Commit**

```bash
git add web/src/components/task/TaskOverviewTab.vue
git commit -m "feat(task-tab): add TaskOverviewTab component with task info and actions"
```

---

### Task 4: 创建 TaskExecDetail.vue

**Files:**
- Create: `web/src/components/task/TaskExecDetail.vue`

**Step 1: 创建 TaskExecDetail.vue**

从 TaskExecDialog.vue 的 detail view 迁移，改为右侧滑入面板。

```vue
<template>
  <Transition name="slide-panel">
    <div v-if="open" class="exec-detail-overlay" @click.self="$emit('close')">
      <div class="exec-detail-panel">
        <div class="exec-detail-header">
          <button class="back-btn" @click="$emit('close')">
            <ArrowLeft :size="18" />
          </button>
          <span class="exec-detail-time">{{ formattedTime }}</span>
          <button class="info-btn" @click="metadataOpen = true" :title="t('chat.meta.title')">
            <Info :size="16" />
          </button>
        </div>
        <div class="exec-detail-content" ref="contentRef">
          <ContentBlocks
            v-if="parsedBlocks.length > 0"
            :blocks="parsedBlocks"
            :msgId="execDetail?.id"
            :blockTasks="{}"
            :expandedTools="expandedTools"
            @toggle-tool="toggleTool"
          />
          <div v-else class="exec-detail-empty">{{ t('task.exec.noTextOutput') }}</div>
        </div>
      </div>
      <ChatMetadataModal
        :show="metadataOpen"
        :data="execDetail?.metadata || {}"
        :createdAt="execDetail?.createdAt"
        :formatDetailTime="formatAbsoluteTime"
        @close="metadataOpen = false"
      />
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Info } from 'lucide-vue-next'
import ContentBlocks from '@/components/chat/ContentBlocks.vue'
import ChatMetadataModal from '@/components/chat/ChatMetadataModal.vue'
import { useChatRender } from '@/composables/useChatRender.ts'
import { formatDateTime } from '@/utils/format.ts'
import { store } from '@/stores/app.ts'

const { t } = useI18n()

// useChatRender requires options with messages, theme, currentSessionId
// Same pattern as TaskExecDialog.vue
const renderTheme = ref('light')
const chatRender = useChatRender({ messages: ref([]), theme: renderTheme, currentSessionId: ref('') })

const props = defineProps({
  open: Boolean,
  execDetail: Object,
})

defineEmits(['close'])

const metadataOpen = ref(false)
const contentRef = ref(null)
const expandedTools = ref({})
const parsedBlocks = computed(() => {
  if (!props.execDetail?.content) return []
  return chatRender.parseAssistantContent(props.execDetail.content)
})

const formattedTime = computed(() => {
  if (!props.execDetail) return ''
  return formatDateTime(props.execDetail.createdAt || props.execDetail.startedAt)
})

function formatAbsoluteTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString()
}

function toggleTool(key) {
  expandedTools.value[key] = !expandedTools.value[key]
}

// File path click handler — use store.selectFile + switch to viewer tab
// (same pattern as ChatPanelContent.handleSelectFile / handleBrowseSelectFile)
function handleDetailClick(e) {
  const btn = e.target.closest('.chat-file-open-btn')
  if (!btn) return
  const filePath = btn.dataset.path
  if (filePath) {
    store.selectFile(filePath)
    // Switch to viewer tab — emit event for parent (TaskTab → App.vue) to handle
    emit('open-file', filePath)
  }
}

watch(() => props.open, (val) => {
  if (val) {
    nextTick(() => {
      document.addEventListener('click', handleDetailClick, true)
    })
  } else {
    document.removeEventListener('click', handleDetailClick, true)
    metadataOpen.value = false
  }
})

onUnmounted(() => {
  document.removeEventListener('click', handleDetailClick, true)
})
</script>

<style scoped>
.exec-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  justify-content: flex-end;
}

.exec-detail-panel {
  width: 100%;
  max-width: 480px;
  background: var(--bg-primary, #fff);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.exec-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color, #e5e5e5);
  flex-shrink: 0;
}

.back-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  color: var(--accent-color, #0066cc);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: background 0.15s;
}

.back-btn:hover {
  background: var(--bg-tertiary, rgba(0, 0, 0, 0.06));
}

.exec-detail-time {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #1a1a1a);
}

.info-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  color: var(--text-muted, #999);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.info-btn:hover {
  color: var(--text-secondary, #666);
  background: var(--bg-tertiary, rgba(0, 0, 0, 0.06));
}

.exec-detail-content {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 16px;
}

.exec-detail-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-muted, #999);
  font-size: 13px;
}

/* Slide transition */
.slide-panel-enter-active { transition: transform 0.25s ease-out; }
.slide-panel-leave-active { transition: transform 0.2s ease-in; }
.slide-panel-enter-from,
.slide-panel-leave-to { transform: translateX(100%); }
</style>
```

**Step 2: Commit**

```bash
git add web/src/components/task/TaskExecDetail.vue
git commit -m "feat(task-tab): add TaskExecDetail slide-in panel for execution details"
```

---

### Task 5: 创建 TaskHistoryTab.vue

**Files:**
- Create: `web/src/components/task/TaskHistoryTab.vue`

**Step 1: 创建 TaskHistoryTab.vue**

从 TaskExecDialog.vue 迁移执行历史列表逻辑。

```vue
<template>
  <div class="task-history">
    <!-- Running executions -->
    <div v-for="exec in runningExecs" :key="exec.id" class="exec-item running" @click="openDetail(exec)">
      <div class="exec-item-dot running-dot"></div>
      <div class="exec-item-info">
        <div class="exec-item-header">
          <span class="exec-trigger-badge auto">{{ t('task.exec.auto') }}</span>
          <span class="exec-item-time">{{ t('task.exec.running') }}</span>
        </div>
      </div>
      <button class="cancel-btn" @click.stop="cancelExecution(exec.id)">{{ t('task.exec.cancel') }}</button>
    </div>

    <!-- Completed executions -->
    <div v-for="exec in completedExecs" :key="exec.id" class="exec-item" :class="{ 'has-unread': exec.unread }" @click="openDetail(exec)">
      <div class="exec-item-dot" :class="{ 'unread-dot': exec.unread }"></div>
      <div class="exec-item-info">
        <div class="exec-item-header">
          <span class="exec-trigger-badge" :class="exec.triggerType || 'auto'">{{ exec.triggerType === 'manual' ? t('task.exec.manual') : t('task.exec.auto') }}</span>
          <span class="exec-item-time">{{ formatExecTime(exec) }}</span>
        </div>
        <div v-if="exec.summary" class="exec-item-summary">{{ exec.summary }}</div>
        <div class="exec-item-meta">
          <span v-if="exec.duration">{{ formatDuration(exec.duration) }}</span>
          <span v-if="exec.model">{{ exec.model }}</span>
          <span v-if="exec.tokenCount">{{ formatTokens(exec) }}</span>
        </div>
      </div>
      <ChevronRight :size="14" class="exec-chevron" />
    </div>

    <div v-if="!loading && completedExecs.length === 0 && runningExecs.length === 0" class="history-empty">
      {{ t('task.exec.noExecutions') }}
    </div>

    <TaskExecDetail
      :open="detailOpen"
      :execDetail="selectedExec"
      @close="detailOpen = false"
      @open-file="onOpenFile"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from 'lucide-vue-next'
import TaskExecDetail from '@/components/task/TaskExecDetail.vue'
import { useDialog } from '@/composables/useDialog.ts'
import { useChatRender } from '@/composables/useChatRender.ts'
import { formatDateTime, formatDuration } from '@/utils/format.ts'
import { store } from '@/stores/app.ts'

const { t } = useI18n()
const dialog = useDialog()
// useChatRender requires options — same pattern as TaskExecDialog.vue
const renderTheme = ref('light')
const chatRender = useChatRender({ messages: ref([]), theme: renderTheme, currentSessionId: ref('') })

const emit = defineEmits(['open-file'])

// File open from TaskExecDetail — close detail, select file, switch to viewer tab
function onOpenFile(filePath) {
  detailOpen.value = false
  store.selectFile(filePath)
  emit('open-file', filePath)  // propagate up to TaskTab → App.vue
}

const props = defineProps({
  task: Object,
})

const loading = ref(false)
const executions = ref([])
const runningExecutions = ref([])
const detailOpen = ref(false)
const selectedExec = ref(null)
let pollingTimer = null

const runningExecs = computed(() => runningExecutions.value || [])
const completedExecs = computed(() => executions.value || [])

function extractSummary(exec) {
  if (!exec.content) return ''
  const blocks = chatRender.parseAssistantContent(exec.content)
  const textBlock = blocks.find(b => b.type === 'text' && b.text)
  if (!textBlock) return ''
  let text = textBlock.text
  text = text.replace(/<scheduled-task[^/]*\/>/g, '').trim()
  text = text.replace(/[#*_`[\]]/g, '').trim()
  return text.slice(0, 120) + (text.length > 120 ? '...' : '')
}

function formatExecTime(exec) {
  const time = exec.completedAt || exec.startedAt || exec.createdAt
  return formatDateTime(time)
}

function formatTokens(exec) {
  const input = exec.inputTokens || exec.metadata?.inputTokens
  const output = exec.outputTokens || exec.metadata?.outputTokens
  if (input && output) return `${input}→${output}`
  if (input || output) return `${input || 0}→${output || 0}`
  return ''
}

async function loadExecutions() {
  if (!props.task?.id) return
  loading.value = true
  try {
    const resp = await fetch(`/api/tasks/${props.task.id}/executions`)
    if (!resp.ok) return
    const data = await resp.json()
    const execs = (data.executions || []).map(e => ({ ...e, summary: extractSummary(e) }))
    executions.value = execs.filter(e => e.status !== 'running')
  } catch (err) {
    console.error('Failed to load executions:', err)
  } finally {
    loading.value = false
  }
}

async function loadRunningStatus() {
  if (!props.task?.id) return
  try {
    const resp = await fetch(`/api/tasks/${props.task.id}`)
    if (!resp.ok) return
    const data = await resp.json()
    runningExecutions.value = data.runningExecutions || []
  } catch (err) {
    // ignore
  }
}

function startPolling() {
  loadRunningStatus()
  pollingTimer = setInterval(loadRunningStatus, 3000)
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
}

async function cancelExecution(execId) {
  if (!await dialog.confirm(t('task.exec.confirmCancel'))) return
  try {
    await fetch(`/api/tasks/${props.task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', executionId: execId }),
    })
    await loadRunningStatus()
  } catch (err) {
    console.error('Failed to cancel execution:', err)
  }
}

async function openDetail(exec) {
  // Mark as read if unread
  if (exec.unread && props.task?.id) {
    fetch(`/api/tasks/${props.task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read' }),
    }).catch(() => {})
  }
  selectedExec.value = exec
  detailOpen.value = true
}

watch(() => props.task?.id, (id) => {
  if (id) {
    loadExecutions()
    startPolling()
  } else {
    stopPolling()
  }
}, { immediate: true })

onUnmounted(stopPolling)
</script>

<style scoped>
.task-history {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.exec-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.15s;
  gap: 8px;
}

@media (hover: hover) {
  .exec-item:hover {
    background: var(--bg-tertiary, rgba(0, 0, 0, 0.03));
  }
}

.exec-item:active {
  background: var(--bg-tertiary, rgba(0, 0, 0, 0.06));
}

.exec-item:not(:last-child) {
  border-bottom: 1px solid var(--border-color, #e5e5e5);
}

.exec-item.running {
  background: rgba(34, 197, 94, 0.04);
}

.exec-item-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted, #ccc);
  flex-shrink: 0;
}

.exec-item-dot.running-dot {
  background: #22c55e;
  animation: exec-running-pulse 1.5s ease-in-out infinite;
}

.exec-item-dot.unread-dot {
  background: var(--accent-color, #0066cc);
  animation: exec-unread-pulse 0.8s ease-in-out infinite;
}

@keyframes exec-running-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  50% { box-shadow: 0 0 6px 2px rgba(34, 197, 94, 0.2); }
}

@keyframes exec-unread-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.exec-item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.exec-item-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.exec-trigger-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 500;
  flex-shrink: 0;
}

.exec-trigger-badge.auto { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
.exec-trigger-badge.manual { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }

.exec-item-time {
  color: var(--text-muted, #999);
  font-size: 12px;
}

.exec-item-summary {
  font-size: 12px;
  color: var(--text-secondary, #666);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.exec-item-meta {
  display: flex;
  gap: 6px;
  font-size: 10px;
  color: var(--text-muted, #999);
  font-variant-numeric: tabular-nums;
}

.cancel-btn {
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid rgba(220, 53, 69, 0.3);
  border-radius: 4px;
  background: none;
  color: #dc3545;
  cursor: pointer;
  flex-shrink: 0;
}

.cancel-btn:hover {
  background: rgba(220, 53, 69, 0.08);
}

.exec-chevron {
  color: var(--text-muted, #ccc);
  flex-shrink: 0;
}

.history-empty {
  padding: 48px 16px;
  text-align: center;
  color: var(--text-muted, #999);
  font-size: 13px;
}
</style>
```

**Step 2: Commit**

```bash
git add web/src/components/task/TaskHistoryTab.vue
git commit -m "feat(task-tab): add TaskHistoryTab component with execution list and detail panel"
```

---

### Task 6: 创建 TaskDetailPage.vue

**Files:**
- Create: `web/src/components/task/TaskDetailPage.vue`

**Step 1: 创建 TaskDetailPage.vue**

```vue
<template>
  <div class="task-detail-page">
    <!-- Header -->
    <div class="detail-header">
      <button class="back-btn" @click="$emit('back')">
        <ArrowLeft :size="18" />
      </button>
      <span class="detail-title">{{ task?.name || t('chat.contentBlocks.loading') }}</span>
      <button class="edit-btn" @click="$emit('edit')" :title="t('task.form.editTitle')">
        <Pencil :size="16" />
      </button>
    </div>

    <!-- Sub tabs -->
    <div class="sub-tabs">
      <button class="sub-tab" :class="{ active: subTab === 'overview' }" @click="subTab = 'overview'">
        {{ t('task.form.tabSettings') }}
      </button>
      <button class="sub-tab" :class="{ active: subTab === 'history' }" @click="subTab = 'history'">
        {{ t('task.exec.title') }}
      </button>
    </div>

    <!-- Tab content -->
    <div class="detail-content">
      <TaskOverviewTab v-if="subTab === 'overview'" :task="task" @deleted="$emit('deleted')" />
      <TaskHistoryTab v-else :task="task" @open-file="$emit('open-file', $event)" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Pencil } from 'lucide-vue-next'
import TaskOverviewTab from '@/components/task/TaskOverviewTab.vue'
import TaskHistoryTab from '@/components/task/TaskHistoryTab.vue'
import { useTaskTab } from '@/composables/useTaskTab.ts'

const { t } = useI18n()
const { detailSubTab } = useTaskTab()

const props = defineProps({
  task: Object,
})

defineEmits(['back', 'edit', 'deleted', 'open-file'])

const subTab = computed({
  get: () => detailSubTab.value,
  set: (val) => { detailSubTab.value = val },
})
</script>

<style scoped>
.task-detail-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color, #e5e5e5);
  flex-shrink: 0;
}

.back-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  color: var(--accent-color, #0066cc);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: background 0.15s;
}

.back-btn:hover {
  background: var(--bg-tertiary, rgba(0, 0, 0, 0.06));
}

.detail-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #1a1a1a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  color: var(--text-muted, #999);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.edit-btn:hover {
  color: var(--accent-color, #0066cc);
  background: var(--bg-tertiary, rgba(0, 0, 0, 0.06));
}

.sub-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-color, #e5e5e5);
  flex-shrink: 0;
}

.sub-tab {
  flex: 1;
  padding: 8px 0;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted, #999);
  cursor: pointer;
  position: relative;
  transition: color 0.15s;
}

.sub-tab.active {
  color: var(--accent-color, #0066cc);
}

.sub-tab.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 20%;
  right: 20%;
  height: 2px;
  background: var(--accent-color, #0066cc);
  border-radius: 1px;
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
</style>
```

**Step 2: Commit**

```bash
git add web/src/components/task/TaskDetailPage.vue
git commit -m "feat(task-tab): add TaskDetailPage with sub-tabs for overview and history"
```

---

### Task 7: 创建 TaskTab.vue

**Files:**
- Create: `web/src/components/task/TaskTab.vue`

**Step 1: 创建 TaskTab.vue**

```vue
<template>
  <div class="task-tab" v-show="active">
    <Transition name="slide-view" mode="out-in">
      <TaskListPage
        v-if="currentView === 'list'"
        key="list"
        ref="listPageRef"
        @create="openCreateDialog"
        @select="onTaskSelect"
      />
      <TaskDetailPage
        v-else
        key="detail"
        :task="selectedTaskData"
        @back="goBack"
        @edit="openEditDialog"
        @deleted="onTaskDeleted"
        @open-file="onOpenFile"
      />
    </Transition>

    <TaskFormDialog
      :open="formOpen"
      :mode="formMode"
      :task="formTaskData"
      @close="formOpen = false"
      @saved="onFormSaved"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import TaskListPage from '@/components/task/TaskListPage.vue'
import TaskDetailPage from '@/components/task/TaskDetailPage.vue'
import TaskFormDialog from '@/components/task/TaskFormDialog.vue'
import { useTaskTab } from '@/composables/useTaskTab.ts'
import { store } from '@/stores/app.ts'

const props = defineProps({
  active: Boolean,
})

const emit = defineEmits(['open-file'])

const {
  currentView,
  selectedTaskId,
  navigateToTask,
  goBack,
  loadTasks,
} = useTaskTab()

const listPageRef = ref(null)
const formOpen = ref(false)
const formMode = ref('create')
const formTaskData = ref(null)

// Use store.state.tasks directly (not child ref) — store is the single source of truth
const selectedTaskData = computed(() => {
  if (!selectedTaskId.value) return null
  return (store.state.tasks || []).find(t => t.id === selectedTaskId.value) || null
})

function onTaskSelect(taskId) {
  navigateToTask(taskId)
}

function openCreateDialog() {
  formMode.value = 'create'
  formTaskData.value = null
  formOpen.value = true
}

function openEditDialog() {
  if (!selectedTaskData.value) return
  formMode.value = 'edit'
  formTaskData.value = selectedTaskData.value
  formOpen.value = true
}

async function onFormSaved(newTaskId) {
  formOpen.value = false
  await loadTasks()
  // TaskFormDialog now emits 'saved' with the new task ID
  if (formMode.value === 'create' && newTaskId) {
    navigateToTask(newTaskId)
  }
  listPageRef.value?.refresh()
}

function onTaskDeleted() {
  goBack()
  loadTasks()
  listPageRef.value?.refresh()
}

function onOpenFile(filePath) {
  emit('open-file', filePath)
}
</script>

<style scoped>
.task-tab {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* View transition */
.slide-view-enter-active { transition: transform 0.25s ease-out, opacity 0.25s; }
.slide-view-leave-active { transition: transform 0.2s ease-in, opacity 0.2s; }
.slide-view-enter-from { transform: translateX(30px); opacity: 0; }
.slide-view-leave-to { transform: translateX(-30px); opacity: 0; }
</style>
```

**Step 2: Commit**

```bash
git add web/src/components/task/TaskTab.vue
git commit -m "feat(task-tab): add TaskTab main container with three-level navigation"
```

---

### Task 7.5: 修改 TaskFormDialog — emit 新任务 ID

**Files:**
- Modify: `web/src/components/task/TaskFormDialog.vue`

**Step 1: 修改 submit() 函数**

当前 `submit()` (line 380-386) 在 POST/PUT 成功后调用 `emit('saved')` 不传参数。需要修改为解析响应并传递新任务 ID。

找到 TaskFormDialog.vue 中 submit() 函数的创建分支（POST /api/tasks）：

从:
```javascript
    if (!resp.ok) {
      const err = await resp.json()
      errors.value = { cronExpr: err.error || t('task.form.operationFailed') }
      return
    }

    emit('saved')
```

改为:
```javascript
    if (!resp.ok) {
      const err = await resp.json()
      errors.value = { cronExpr: err.error || t('task.form.operationFailed') }
      return
    }

    const result = await resp.json()
    emit('saved', result.task?.id)
```

**注意**：PUT（编辑模式）的响应同样返回 `{ ok: true, task: <task> }`，所以 `result.task?.id` 对两种模式都有效。对于编辑模式，`onFormSaved` 中 `formMode.value === 'create'` 条件会跳过导航。

**Step 2: 同步修改 pauseTask 和 resumeTask 的 emit**

`pauseTask()` (line 404) 和 `resumeTask()` (line 421) 也调用 `emit('saved')`。这些不需要传 task ID（不是创建模式），保持 `emit('saved')` 不变即可，因为 `onFormSaved` 中 `formMode.value === 'create'` 条件会跳过。

**Step 3: Commit**

```bash
git add web/src/components/task/TaskFormDialog.vue
git commit -m "feat(task-tab): TaskFormDialog emits saved with new task ID"
```

---

### Task 8: App.vue 集成 — 新增 Tasks Tab

**Files:**
- Modify: `web/src/App.vue`

**Step 1: 添加 import 和组件注册**

在 App.vue 的 script 中添加:

```javascript
import TaskTab from '@/components/task/TaskTab.vue'
import { useTaskTab } from '@/composables/useTaskTab.ts'
```

在 setup 中获取:

```javascript
const { startTaskPolling, stopTaskPolling, navigateToTask } = useTaskTab()
```

**Step 2: 添加 Tasks dock 按钮**

在底部导航 dock-center 中，History 按钮之后、PortForward 按钮之前，添加:

```html
<button class="dock-btn" :class="{ active: activeTab === 'tasks', 'has-unread': store.state.taskUnread && activeTab !== 'tasks' }" @click.stop="switchTab('tasks')" :title="t('nav.tasks')">
  <Clock />
</button>
```

需要确保 `Clock` 已从 lucide-vue-next 导入。

**Step 3: 修改 switchTab 函数**

```javascript
function switchTab(tab) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  if (tab === 'chat') {
    store.state.chatUnread = false
    // 移除: store.state.taskUnread = false
  }
  if (tab === 'tasks') {
    store.state.taskUnread = false
  }
}
```

**Step 4: 修改 Chat 按钮 has-unread 条件**

从:
```html
'has-unread': (store.state.chatUnread || store.state.taskUnread) && activeTab !== 'chat'
```

改为:
```html
'has-unread': store.state.chatUnread && activeTab !== 'chat'
```

同样修改 `has-running` 条件，移除 `taskUnread`:

从:
```html
'has-running': store.state.chatRunning && activeTab !== 'chat' && !store.state.chatUnread && !store.state.taskUnread
```

改为:
```html
'has-running': store.state.chatRunning && activeTab !== 'chat' && !store.state.chatUnread
```

**Step 5: 添加 TaskTab 渲染**

在模板中其他 Tab 面板旁边添加:

```html
<TaskTab v-if="activeTab === 'tasks'" :active="activeTab === 'tasks'" />
```

**Step 6: 添加轮询生命周期**

在 `onMounted` 中添加:
```javascript
startTaskPolling()
```

在 `onUnmounted` 中添加:
```javascript
stopTaskPolling()
```

**Step 7: 修改 onMounted 中的 task 初始加载**

移除 onMounted 中现有的 `/api/tasks` fetch 代码块（lines 538-541），因为 `startTaskPolling()` 会执行初始加载。

**Step 8: 修改 dock-center gap**

从:
```css
.dock-center { gap: 10px; }
```

改为:
```css
.dock-center { gap: 8px; }
```

**Step 9: 添加 i18n 导航键**

在 `web/src/i18n/locales/en.ts` 和 `zh.ts` 的 `nav` 部分添加:
- `nav.tasks`: EN `'Tasks'`, ZH `'定时任务'`

**Step 10: 验证编译通过**

Run: `cd web && npx vite build 2>&1 | tail -20`
Expected: 构建成功

**Step 11: Commit**

```bash
git add web/src/App.vue web/src/i18n/locales/en.ts web/src/i18n/locales/zh.ts
git commit -m "feat(task-tab): integrate Tasks tab into App.vue bottom dock"
```

---

### Task 9: 清理 Chat 模块 — 移除任务相关代码

**Files:**
- Modify: `web/src/components/chat/ChatPanel.vue`
- Modify: `web/src/components/chat/ChatPanelContent.vue`
- Modify: `web/src/components/chat/ChatInputBar.vue`
- Modify: `web/src/composables/useChatSession.ts`

**Step 1: ChatPanel.vue 清理**

移除:
- `import TaskDrawer` (line 177)
- `import TaskFormDialog` (line 178)
- `import TaskExecDialog` (line 179)
- TaskDrawer 模板 (lines 148-152)
- TaskFormDialog 模板 (lines 154-161)
- TaskExecDialog 模板 (lines 162-166)
- `taskEditOpen` ref (line 259)
- `taskEditData` ref (line 260)
- `taskHistoryOpen` ref (line 261)
- `taskHistoryData` ref (line 262)
- `openTaskEdit()` function (lines 264-274)
- `openTaskHistory()` function (lines 276-286)
- `handleTaskEditSaved()` function (lines 288-291)
- `handleTaskAction()` function (lines 293-309)
- `@edit-task` event binding on ChatMessageList (line 33)
- `@view-history` event binding on ChatMessageList (line 34)
- `@task-action` event binding on ChatMessageList (line 35)
- `session.taskDrawerOpen.value = false` in watch (line 490)

添加:
- 新的事件处理 `@task-card-click` 在 ChatMessageList 上，emit 给父级

ChatMessageList 事件改为:
```html
@task-card-click="handleTaskCardClick"
```

添加函数:
```javascript
const emit = defineEmits(['task-card-click'])

function handleTaskCardClick(taskId) {
  emit('task-card-click', taskId)
}
```

**Step 2: ChatPanelContent.vue 清理**

同 ChatPanel.vue 相同的清理操作：
- 移除 TaskDrawer/TaskFormDialog/TaskExecDialog 的 import (lines 167-169)
- 移除模板中的三个组件 (lines 139-158)
- 移除 `taskEditOpen/taskEditData/taskHistoryOpen/taskHistoryData` refs (lines 249-253)
- 移除 `openTaskEdit/openTaskHistory/handleTaskEditSaved/handleTaskAction` 函数 (lines 255-300)
- 移除 `session.taskDrawerOpen.value = false` (line 480)
- 移除 ChatMessageList 上的 `@edit-task/@view-history/@task-action` (lines 24-26)
- 添加 `@task-card-click` emit 向上传递

**Step 3: ChatInputBar.vue 清理**

移除:
- 任务按钮模板 (lines 26-30)
- `Calendar` 从 lucide import 中移除（如果仅用于此按钮）
- `taskUnread` prop 定义 (line 194)

**Step 4: useChatSession.ts 清理**

移除:
- `taskDrawerOpen` ref (line 91)
- `taskDrawerOpen` return value (line 534)
- `openSessionTab` 中的 tasks 分支 (lines 366-367)
- 全局轮询中的 `/api/tasks` fetch 代码块 (lines 427-442)
- `totalTaskUnread` 变量（如仍然存在）
- 如果 `openSessionTab` 只剩 session 逻辑，简化为只开 session drawer

**Step 5: 验证编译通过**

Run: `cd web && npx vite build 2>&1 | tail -20`
Expected: 构建成功

**Step 6: Commit**

```bash
git add web/src/components/chat/ChatPanel.vue web/src/components/chat/ChatPanelContent.vue web/src/components/chat/ChatInputBar.vue web/src/composables/useChatSession.ts
git commit -m "refactor(task-tab): remove task-related code from chat module"
```

---

### Task 10: 调整 ContentBlocks 卡片 — 简化为跳转按钮

**Files:**
- Modify: `web/src/components/chat/ContentBlocks.vue`
- Modify: `web/src/components/chat/ChatMessageItem.vue`
- Modify: `web/src/components/chat/ChatMessageList.vue`

**Step 1: 简化 scheduled-task 卡片模板**

将现有的复杂操作按钮卡片 (lines 46-79) 替换为简化版本:

```vue
<!-- Scheduled task card(s) — simplified: click navigates to Tasks tab -->
<template v-else-if="block.type === 'text' && hasScheduledTasks(bi)">
  <div v-if="getBlockHtml(bi, block)" v-html="getBlockHtml(bi, block)"></div>
  <div v-for="(sKey, sIdx) in scheduledTaskKeys(bi)" :key="sIdx" class="scheduled-task-card" :class="{ deleted: blockTasks[sKey].deleted }" @click="!blockTasks[sKey].deleted && !blockTasks[sKey].loading && blockTasks[sKey].task && $emit('task-card-click', blockTasks[sKey].taskId)">
    <div class="stask-header">
      <span v-if="blockTasks[sKey].deleted" class="stask-icon">🗑️</span>
      <span v-else class="stask-icon">⏰</span>
      <template v-if="blockTasks[sKey].deleted">{{ t('chat.contentBlocks.taskDeleted') }}</template>
      <template v-else-if="blockTasks[sKey].loading">{{ t('chat.contentBlocks.loading') }}</template>
      <template v-else>{{ blockTasks[sKey].task?.name || t('chat.contentBlocks.scheduledTaskCreated') }}</template>
      <span v-if="!blockTasks[sKey].deleted && !blockTasks[sKey].loading && blockTasks[sKey].task" class="stask-status-badge" :class="blockTasks[sKey].task.status">{{ statusLabelSimple(blockTasks[sKey].task) }}</span>
    </div>
    <div v-if="!blockTasks[sKey].deleted && !blockTasks[sKey].loading && blockTasks[sKey].task" class="stask-body">
      <div class="stask-row"><strong>{{ t('chat.contentBlocks.frequency') }}</strong>{{ humanizeCron(blockTasks[sKey].task.cronExpr) }}</div>
      <div class="stask-row"><strong>{{ t('chat.contentBlocks.executor') }}</strong>{{ getAgentIcon(blockTasks[sKey].task.agentId) }} {{ getAgentName(blockTasks[sKey].task.agentId) }}</div>
    </div>
    <div class="stask-view-btn" v-if="!blockTasks[sKey].deleted && !blockTasks[sKey].loading && blockTasks[sKey].task">
      {{ t('chat.contentBlocks.viewDetail') }}
      <ChevronRight :size="12" />
    </div>
  </div>
</template>
```

**Step 2: 更新 emits**

从:
```javascript
const emit = defineEmits(['toggle-tool', 'show-tool-detail', 'edit-task', 'view-history', 'task-action', 'send-message', 'render-flush'])
```

改为:
```javascript
const emit = defineEmits(['toggle-tool', 'show-tool-detail', 'task-card-click', 'send-message', 'render-flush'])
```

移除 `edit-task`, `view-history`, `task-action`，添加 `task-card-click`。

**Step 3: 添加简化 status label 和 ChevronRight import**

```javascript
import { History, Trash2, ChevronRight } from 'lucide-vue-next'
```

(可以移除 `History` 和 `Trash2` 如果不再使用)

添加:
```javascript
function statusLabelSimple(task) {
  if (task.status === 'active') return t('chat.contentBlocks.statusActive')
  if (task.status === 'paused') return t('chat.contentBlocks.statusPaused')
  if (task.status === 'completed') return t('chat.contentBlocks.statusCompleted')
  return task.status
}
```

**Step 4: 添加 i18n 键**

在 en.ts 和 zh.ts 中添加:
- `chat.contentBlocks.viewDetail`: EN `'View details'`, ZH `'查看详情'`

**Step 5: 添加卡片样式**

```css
.stask-view-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 0;
  font-size: 12px;
  color: var(--accent-color, #0066cc);
  font-weight: 500;
}

.stask-status-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 500;
  margin-left: auto;
}

.stask-status-badge.active { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
.stask-status-badge.paused { background: rgba(234, 179, 8, 0.12); color: #eab308; }
.stask-status-badge.completed { background: var(--bg-tertiary, #e9ecef); color: var(--text-muted, #999); }
```

**Step 6: 更新 ChatMessageItem.vue 事件链**

ChatMessageItem.vue (line 120) 当前 defineEmits 包含 `'edit-task', 'view-history', 'task-action'`，需替换为 `'task-card-click'`。

从:
```javascript
const emit = defineEmits(['toggle-tool', 'show-tool-detail', 'show-metadata', 'file-tag-click', 'expand', 'collapse', 'edit-task', 'view-history', 'task-action', 'send-message', 'render-flush'])
```

改为:
```javascript
const emit = defineEmits(['toggle-tool', 'show-tool-detail', 'show-metadata', 'file-tag-click', 'expand', 'collapse', 'task-card-click', 'send-message', 'render-flush'])
```

模板中的事件绑定 (lines 28-34)，从:
```html
@edit-task="$emit('edit-task', $event)"
@view-history="$emit('view-history', $event)"
@task-action="(id, action) => $emit('task-action', id, action)"
```

改为:
```html
@task-card-click="$emit('task-card-click', $event)"
```

**Step 7: 更新 ChatMessageList.vue 事件链**

ChatMessageList.vue (line 104) 当前 defineEmits 包含 `'edit-task', 'view-history', 'task-action'`，需替换为 `'task-card-click'`。

从:
```javascript
const emit = defineEmits(['toggle-tool', 'show-tool-detail', 'show-metadata', 'file-tag-click', 'file-open', 'load-more', 'edit-task', 'view-history', 'task-action', 'send-message', 'remove-pending', 'render-flush'])
```

改为:
```javascript
const emit = defineEmits(['toggle-tool', 'show-tool-detail', 'show-metadata', 'file-tag-click', 'file-open', 'load-more', 'task-card-click', 'send-message', 'remove-pending', 'render-flush'])
```

模板中的事件绑定 (lines 54-56)，从:
```html
@edit-task="$emit('edit-task', $event)"
@view-history="$emit('view-history', $event)"
@task-action="(id, action) => $emit('task-action', id, action)"
```

改为:
```html
@task-card-click="$emit('task-card-click', $event)"
```

**Step 8: 验证编译通过**

Run: `cd web && npx vite build 2>&1 | tail -20`
Expected: 构建成功

**Step 8: Commit**

```bash
git add web/src/components/chat/ContentBlocks.vue web/src/components/chat/ChatMessageItem.vue web/src/components/chat/ChatMessageList.vue web/src/i18n/locales/en.ts web/src/i18n/locales/zh.ts
git commit -m "refactor(task-tab): simplify scheduled-task cards to view-detail navigation"
```

---

### Task 11: 连接聊天卡片跳转链路

**Files:**
- Modify: `web/src/App.vue`
- Modify: `web/src/components/chat/ChatPanel.vue` 或 `ChatPanelContent.vue`

**Step 1: App.vue 接收 task-card-click 事件**

在 ChatPanel/ChatPanelContent 的渲染处添加事件监听:

```html
<ChatPanelContent ... @task-card-click="onTaskCardClick" />
```

添加处理函数:
```javascript
function onTaskCardClick(taskId) {
  const { navigateToTask } = useTaskTab()
  navigateToTask(taskId)
  switchTab('tasks')
}
```

**Step 2: App.vue 处理 TaskTab 的 open-file 事件**

TaskTab 渲染处添加 `@open-file` 事件:

```html
<TaskTab v-show="activeTab === 'tasks'" :active="activeTab === 'tasks'" @open-file="handleTaskOpenFile" />
```

添加处理函数:
```javascript
async function handleTaskOpenFile(filePath) {
  await store.selectFile(filePath)
  switchTab('viewer')
}
```

**Step 3: 确保事件从 ChatPanelContent 冒泡到 App.vue**

ChatPanel/ChatPanelContent 需要将 `task-card-click` 事件向上传递到 App.vue。检查 ChatPanel 是否被 App.vue 直接引用（或通过 TabPanel），确保事件链完整：

ChatPanelContent.vue:
```html
@task-card-click="(taskId) => $emit('task-card-click', taskId)"
```
添加 defineEmits 包含 `'task-card-click'`。

ChatPanel.vue（如果有的话）同理透传。

App.vue 的 Chat 面板渲染处:
```html
@task-card-click="onTaskCardClick"
```

**Step 4: 验证完整流程**

手动测试:
1. 在聊天中让 AI 创建一个定时任务
2. 点击聊天中的 `<scheduled-task>` 卡片
3. 验证: 跳转到 Tasks Tab → 自动打开该任务的详情概览

**Step 4: Commit**

```bash
git add web/src/App.vue web/src/components/chat/
git commit -m "feat(task-tab): connect chat card click to navigate to Tasks tab detail"
```

---

### Task 12: 删除旧文件

**Files:**
- Delete: `web/src/components/task/TaskDrawer.vue`
- Delete: `web/src/components/task/TaskExecDialog.vue`

**Step 1: 确认无引用**

Run: `grep -rn "TaskDrawer\|TaskExecDialog" web/src/ --include="*.vue" --include="*.ts"`
Expected: 无结果（所有引用已在 Task 9 中清理）

**Step 2: 删除文件**

```bash
rm web/src/components/task/TaskDrawer.vue web/src/components/task/TaskExecDialog.vue
```

**Step 3: 验证构建**

Run: `cd web && npx vite build 2>&1 | tail -20`
Expected: 构建成功

**Step 4: Commit**

```bash
git add -u web/src/components/task/
git commit -m "chore(task-tab): remove deprecated TaskDrawer and TaskExecDialog"
```

---

### Task 13: 最终验证与清理

**Step 1: 完整构建验证**

Run: `cd /home/xulongzhe/projects/clawbench && ./build.sh`
Expected: 构建成功

**Step 2: 运行前端测试**

Run: `cd web && npm test`
Expected: 所有测试通过

**Step 3: 检查 i18n 完整性**

验证所有新组件中使用的 i18n 键在 en.ts 和 zh.ts 中都有定义。

**Step 4: 清理残留代码**

- 检查 `chat.actions.scheduledTasks` 和 `chat.actions.scheduled` i18n 键是否仍被使用，如果不再使用可保留（向后兼容）
- 检查 `chat.contentBlocks.pause/resume/trigger/delete` i18n 键是否仍被使用

**Step 5: 功能验证清单**

- [ ] Tasks Tab 按钮显示在底部导航
- [ ] 点击 Tasks Tab 进入任务列表
- [ ] 点击 + 创建新任务
- [ ] 点击任务行进入详情概览
- [ ] 概览显示完整任务信息
- [ ] 操作按钮（触发/暂停/恢复/删除）正常工作
- [ ] 执行历史 Tab 显示执行列表
- [ ] 点击执行行滑入详情面板
- [ ] 返回导航正确（详情→列表，面板→历史）
- [ ] 未读脉冲显示在 Tasks Tab 按钮上
- [ ] Chat 按钮不再显示 taskUnread
- [ ] 聊天卡片点击跳转到 Tasks Tab 详情
- [ ] PortForward 仅 App 模式显示
- [ ] 7 个按钮一行排列，间距合适

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore(task-tab): final cleanup and verification"
```
