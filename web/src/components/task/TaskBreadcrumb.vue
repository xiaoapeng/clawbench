<template>
  <div class="task-breadcrumb">
    <!-- Root crumb: 任务列表 -->
    <span
      class="task-crumb"
      :class="{ current: currentView === 'list', clickable: currentView !== 'list' }"
      @click="currentView !== 'list' && $emit('navigate', 'list')"
    >{{ t('task.title') }}</span>

    <!-- Task crumb (shown when a task is selected) -->
    <template v-if="taskName">
      <span class="task-crumb-sep">›</span>
      <span
        class="task-crumb"
        :class="{ current: currentView === 'detail' && !execDetailOpen, clickable: currentView === 'exec' }"
        @click="currentView === 'exec' && $emit('navigate', 'detail')"
      >{{ taskName }}</span>
    </template>

    <!-- Exec crumb (shown when viewing execution detail) -->
    <template v-if="execDetailOpen">
      <span class="task-crumb-sep">›</span>
      <span class="task-crumb current">{{ t('task.exec.title') }}</span>
    </template>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  currentView: { type: String, default: 'list' },
  taskName: String,
  execDetailOpen: Boolean,
})

defineEmits(['navigate'])
</script>

<style scoped>
.task-breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  font-size: 13px;
  color: var(--text-muted, #999);
  scrollbar-width: none;
  flex: 1;
  min-width: 0;
}

.task-breadcrumb::-webkit-scrollbar {
  display: none;
}

.task-crumb {
  padding: 3px 6px;
  border-radius: 4px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

/* Clickable crumb: has navigation target */
.task-crumb.clickable {
  cursor: pointer;
}

.task-crumb.clickable:hover {
  background: var(--bg-secondary, #e0e0e0);
  color: var(--accent-color, #4a90d9);
}

.task-crumb.current {
  font-weight: 600;
  color: var(--text-primary, #1a1a1a);
  cursor: default;
}

.task-crumb.current:hover {
  background: none;
  color: var(--text-primary, #1a1a1a);
}

.task-crumb-sep {
  color: var(--text-muted, #999);
  font-size: 11px;
}
</style>
