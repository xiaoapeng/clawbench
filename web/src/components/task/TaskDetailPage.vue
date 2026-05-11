<template>
  <div class="task-detail-page">
    <!-- Header: breadcrumb + edit button -->
    <div class="detail-header">
      <TaskBreadcrumb
        currentView="detail"
        :taskName="task?.name"
        :execDetailOpen="false"
        @navigate="onBreadcrumbNavigate"
      />
      <button class="edit-btn" @click="$emit('edit')" :title="t('task.form.editTitle')"><Pencil :size="16" /></button>
    </div>
    <!-- Sub tabs -->
    <div class="sub-tabs">
      <button class="sub-tab" :class="{ active: subTab === 'overview' }" @click="subTab = 'overview'">{{ t('task.form.tabSettings') }}</button>
      <button class="sub-tab" :class="{ active: subTab === 'history' }" @click="subTab = 'history'">{{ t('task.exec.title') }}</button>
    </div>
    <!-- Tab content -->
    <div class="detail-content">
      <TaskOverviewTab v-if="subTab === 'overview'" :task="task" @deleted="$emit('deleted')" />
      <TaskHistoryTab v-else :task="task" @open-file="$emit('open-file', $event)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Pencil } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import TaskBreadcrumb from '@/components/task/TaskBreadcrumb.vue'
import TaskOverviewTab from '@/components/task/TaskOverviewTab.vue'
import TaskHistoryTab from '@/components/task/TaskHistoryTab.vue'
import { useTaskTab } from '@/composables/useTaskTab'

const { t } = useI18n()
const { detailSubTab, goBack } = useTaskTab()

defineProps<{
  task: any
}>()

defineEmits<{
  back: []
  edit: []
  deleted: []
  'open-file': [filePath: string]
}>()

const subTab = computed({
  get: () => detailSubTab.value,
  set: (val: 'overview' | 'history') => { detailSubTab.value = val },
})

function onBreadcrumbNavigate(view: string) {
  if (view === 'list') {
    goBack()
  }
}
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
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color, #e5e5e5);
  flex-shrink: 0;
  gap: 8px;
}

.edit-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted, #999);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
}

@media (hover: hover) {
  .edit-btn:hover {
    background: var(--bg-tertiary, rgba(0, 0, 0, 0.04));
  }
}

.edit-btn:active {
  background: var(--bg-tertiary, rgba(0, 0, 0, 0.08));
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
  background: transparent;
  color: var(--text-muted, #999);
  font-size: 13px;
  font-weight: 500;
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
  bottom: -1px;
  left: 20%;
  right: 20%;
  height: 2px;
  background: var(--accent-color, #0066cc);
  border-radius: 1px;
}

.detail-content {
  flex: 1;
  overflow-y: auto;
}
</style>
