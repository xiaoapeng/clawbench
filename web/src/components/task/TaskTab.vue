<template>
  <div class="task-tab" v-show="active">
    <Transition name="slide-view" mode="out-in">
      <TaskListPage v-if="currentView === 'list'" key="list" ref="listPageRef" @create="openCreateDialog" @select="onTaskSelect" />
      <TaskDetailPage v-else-if="!execDetailOpen" key="detail" :task="selectedTaskData" @back="goBack" @edit="openEditDialog" @deleted="onTaskDeleted" @open-file="onOpenFile" />
      <TaskExecDetail v-else key="exec" :execDetail="selectedExecData" :taskName="selectedTaskData?.name" @close="closeExecDetail" @navigate="onExecNavigate" @open-file="onOpenFile" />
    </Transition>
    <TaskFormDialog :open="formOpen" :mode="formMode" :task="formTaskData" @close="formOpen = false" @saved="onFormSaved" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import TaskListPage from '@/components/task/TaskListPage.vue'
import TaskDetailPage from '@/components/task/TaskDetailPage.vue'
import TaskExecDetail from '@/components/task/TaskExecDetail.vue'
import TaskFormDialog from '@/components/task/TaskFormDialog.vue'
import { useTaskTab } from '@/composables/useTaskTab'
import { store } from '@/stores/app'

const props = defineProps<{
  active: boolean
}>()

const emit = defineEmits<{
  'open-file': [filePath: string]
}>()

const { currentView, selectedTaskId, selectedExecData, execDetailOpen, navigateToTask, goBack, closeExecDetail, loadTasks } = useTaskTab()

// Read from store directly — NOT from listPageRef (Vue refs don't expose internal computed)
const selectedTaskData = computed(() =>
  (store.state.tasks || []).find((t: any) => t.id === selectedTaskId.value) || null
)

const listPageRef = ref<InstanceType<typeof TaskListPage> | null>(null)

// TaskFormDialog state
const formOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const formTaskData = ref<any>(null)

function openCreateDialog() {
  formMode.value = 'create'
  formTaskData.value = null
  formOpen.value = true
}

function openEditDialog() {
  formMode.value = 'edit'
  formTaskData.value = selectedTaskData.value
  formOpen.value = true
}

async function onFormSaved(newTaskId: string) {
  formOpen.value = false
  await loadTasks()
  if (formMode.value === 'create' && newTaskId) {
    navigateToTask(newTaskId)
  }
  listPageRef.value?.refresh?.()
}

function onTaskDeleted() {
  goBack()
  loadTasks()
  listPageRef.value?.refresh?.()
}

function onOpenFile(filePath: string) {
  emit('open-file', filePath)
}

function onTaskSelect(taskId: string) {
  navigateToTask(taskId)
}

function onExecNavigate(view: string) {
  closeExecDetail()
  if (view === 'list') {
    goBack()
  }
  // view === 'detail': just closing exec detail is enough, it goes back to detail page
}
</script>

<style scoped>
.task-tab {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.slide-view-enter-active {
  transition: transform 250ms ease-out, opacity 250ms ease-out;
}

.slide-view-leave-active {
  transition: transform 200ms ease-in, opacity 200ms ease-in;
}

.slide-view-enter-from {
  transform: translateX(30px);
  opacity: 0;
}

.slide-view-leave-to {
  transform: translateX(-30px);
  opacity: 0;
}
</style>
