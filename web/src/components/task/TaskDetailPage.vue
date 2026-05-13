<template>
  <div class="task-detail-page">
    <!-- Compact header: breadcrumb only -->
    <div class="detail-header">
      <TaskBreadcrumb />
    </div>
    <!-- Settings content -->
    <div class="detail-content">
      <TaskOverviewTab :task="task" @deleted="$emit('deleted')" @edit="$emit('edit')" @history="$emit('history')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import TaskBreadcrumb from '@/components/task/TaskBreadcrumb.vue'
import TaskOverviewTab from '@/components/task/TaskOverviewTab.vue'

defineProps<{
  task: any
}>()

defineEmits<{
  edit: []
  deleted: []
  history: []
}>()
</script>

<style scoped>
.task-detail-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary, #ffffff);
}

.detail-header {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color, #e5e5e5);
}

.detail-content {
  flex: 1;
  overflow-y: hidden;
  display: flex;
  flex-direction: column;
}
</style>
