import { ref, computed } from 'vue'
import { apiGet, apiPost, apiPut, apiDelete } from '@/utils/api'

export interface QuickCommand {
  id: number
  label: string
  command: string
  hidden: boolean
  auto_execute: boolean
  sort_order: number
}

// Module-level singleton state
const commands = ref<QuickCommand[]>([])
const loaded = ref(false)
const showEditDialog = ref(false)

export function useQuickCommands() {
  const visibleCommands = computed(() => commands.value.filter(c => !c.hidden))
  const autoExecCommand = computed(() => commands.value.find(c => c.auto_execute) || null)

  async function fetchCommands(force = false) {
    if (loaded.value && !force) return
    try {
      const data = await apiGet<QuickCommand[]>('/api/terminal/quick-commands')
      commands.value = data || []
      loaded.value = true
    } catch {
      // Silently fail on initial load
    }
  }

  async function addCommand(cmd: { label: string; command: string; hidden?: boolean; auto_execute?: boolean }): Promise<boolean> {
    try {
      await apiPost('/api/terminal/quick-commands', cmd)
      await fetchCommands(true)
      return true
    } catch {
      return false
    }
  }

  async function updateCommand(id: number, cmd: { label: string; command: string; hidden?: boolean; auto_execute?: boolean }): Promise<boolean> {
    try {
      await apiPut(`/api/terminal/quick-commands/${id}`, cmd)
      await fetchCommands(true)
      return true
    } catch {
      return false
    }
  }

  async function deleteCommand(id: number): Promise<boolean> {
    try {
      await apiDelete(`/api/terminal/quick-commands/${id}`)
      await fetchCommands(true)
      return true
    } catch {
      return false
    }
  }

  async function reorderCommands(ids: number[]): Promise<boolean> {
    const oldCommands = [...commands.value]
    // Optimistic reorder
    const reordered = ids.map((id, i) => {
      const cmd = commands.value.find(c => c.id === id)
      return cmd ? { ...cmd, sort_order: i } : null
    }).filter(Boolean) as QuickCommand[]
    commands.value = reordered
    try {
      await apiPut('/api/terminal/quick-commands/reorder', { ids })
      return true
    } catch {
      commands.value = oldCommands // Rollback
      return false
    }
  }

  return {
    commands,
    visibleCommands,
    autoExecCommand,
    fetchCommands,
    addCommand,
    updateCommand,
    deleteCommand,
    reorderCommands,
    showEditDialog,
    loaded,
  }
}
