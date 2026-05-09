import { ref, computed } from 'vue'
import { apiGet, apiPost, apiPut, apiDelete } from '@/utils/api'
import { useToast } from '@/composables/useToast'

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
const autoExecFired = ref(false)

export function useQuickCommands() {
  const { toast } = useToast()

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

  async function addCommand(cmd: { label: string; command: string; hidden?: boolean; auto_execute?: boolean }) {
    try {
      const result = await apiPost<QuickCommand & { id: number }>('/api/terminal/quick-commands', cmd)
      await fetchCommands(true)
      toast('terminal.commandSaved', 'success')
      return result
    } catch (e: unknown) {
      toast(String(e), 'error')
      throw e
    }
  }

  async function updateCommand(id: number, cmd: { label: string; command: string; hidden?: boolean; auto_execute?: boolean }) {
    try {
      await apiPut(`/api/terminal/quick-commands/${id}`, cmd)
      await fetchCommands(true)
      toast('terminal.commandSaved', 'success')
    } catch (e: unknown) {
      toast(String(e), 'error')
      throw e
    }
  }

  async function deleteCommand(id: number) {
    const oldCommands = [...commands.value]
    // Optimistic update
    commands.value = commands.value.filter(c => c.id !== id)
    try {
      await apiDelete(`/api/terminal/quick-commands/${id}`)
      toast('terminal.commandDeleted', 'success')
    } catch (e: unknown) {
      commands.value = oldCommands // Rollback
      toast(String(e), 'error')
    }
  }

  async function reorderCommands(ids: number[]) {
    const oldCommands = [...commands.value]
    // Optimistic reorder
    const reordered = ids.map((id, i) => {
      const cmd = commands.value.find(c => c.id === id)
      return cmd ? { ...cmd, sort_order: i } : null
    }).filter(Boolean) as QuickCommand[]
    commands.value = reordered
    try {
      await apiPut('/api/terminal/quick-commands/reorder', { ids })
    } catch (e: unknown) {
      commands.value = oldCommands // Rollback
      toast('terminal.reorderFailed', 'error')
    }
  }

  function resetAutoExec() {
    autoExecFired.value = false
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
    autoExecFired,
    resetAutoExec,
    loaded,
  }
}
