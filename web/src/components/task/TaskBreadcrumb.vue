<template>
  <div class="task-breadcrumb">
    <!-- Root crumb: 任务列表 -->
    <span
      class="crumb"
      :class="{ current: isList, clickable: !isList }"
      @click="!isList && navigate('list')"
    >{{ t('task.title') }}</span>

    <!-- Task name crumb -->
    <span
      v-if="taskName"
      class="crumb"
      :class="{ current: isSettings, clickable: !isSettings }"
      @click="!isSettings && navigate('settings')"
    >{{ taskName }}</span>

    <!-- History crumb -->
    <span
      v-if="showHistoryCrumb"
      class="crumb"
      :class="{ current: isHistory, clickable: !isHistory }"
      @click="!isHistory && navigate('history')"
    >{{ t('task.exec.title') }}</span>

    <!-- Exec detail crumb -->
    <span
      v-if="execDetailOpen"
      class="crumb current"
    >{{ t('task.exec.detail') }}</span>

    <!-- Form crumb -->
    <span
      v-if="formViewOpen"
      class="crumb current"
    >{{ formMode === 'create' ? t('task.form.createTitle') : t('task.form.editTitle') }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTaskTab } from '@/composables/useTaskTab'
import { store } from '@/stores/app'

const { t } = useI18n()
const { currentView, selectedTaskId, execDetailOpen, formViewOpen, formMode, navigateToList, navigateToTaskSettings, navigateToTaskHistory } = useTaskTab()

// Derive task name from store (same pattern as TaskTab)
const taskName = computed(() => {
  if (!selectedTaskId.value) return null
  return (store.state.tasks || []).find(t => t.id === selectedTaskId.value)?.name || null
})

// Derived state
const isList = computed(() => currentView.value === 'list' && !formViewOpen.value)
const isSettings = computed(() => currentView.value === 'settings' && !execDetailOpen.value && !formViewOpen.value)
const isHistory = computed(() => currentView.value === 'history' && !execDetailOpen.value && !formViewOpen.value)

const showHistoryCrumb = computed(() => {
  if (formViewOpen.value) return false
  return currentView.value === 'history'
})

// Centralized navigation
function navigate(target) {
  if (target === 'list') {
    navigateToList()
  } else if (target === 'settings') {
    const tid = selectedTaskId.value
    if (tid) navigateToTaskSettings(tid)
  } else if (target === 'history') {
    const tid = selectedTaskId.value
    if (tid) navigateToTaskHistory(tid)
  }
}
</script>

<style scoped>
.task-breadcrumb {
  display: flex;
  align-items: center;
  overflow-x: auto;
  scrollbar-width: none;
  flex: 1;
  min-width: 0;
  /* Arrow height = font-size * line-height + padding-y * 2 */
  height: 22px;
}

.task-breadcrumb::-webkit-scrollbar {
  display: none;
}

/* ── Arrow-shaped crumb ── */
.crumb {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 12px 0 16px;
  height: 100%;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--text-secondary, #666);
  background: var(--bg-tertiary, #e9ecef);
  cursor: default;
  transition: background 0.15s, color 0.15s;

  /* Arrow shape: right edge is a pointed arrow */
  clip-path: polygon(8px 0, 100% 50%, 8px 100%, 0 50%);
}

/* First crumb: flat left edge instead of arrow notch */
.crumb:first-child {
  padding-left: 10px;
  clip-path: polygon(0 0, 100% 50%, 0 100%);
}

/* Overlap each crumb onto the previous one so arrows nest */
.crumb + .crumb {
  margin-left: -6px;
}

/* ── Clickable (past) crumb ── */
.crumb.clickable {
  cursor: pointer;
}

@media (hover: hover) {
  .crumb.clickable:hover {
    background: var(--bg-secondary, #dde1e6);
    color: var(--accent-color, #4a90d9);
  }
}

.crumb.clickable:active {
  background: var(--bg-secondary, #d0d5da);
}

/* ── Current (active) crumb ── */
.crumb.current {
  background: var(--accent-color, #0066cc);
  color: #fff;
  font-weight: 600;
}

@media (hover: hover) {
  .crumb.current:hover {
    background: var(--accent-color, #0066cc);
    color: #fff;
  }
}
</style>
