<template>
  <ModalDialog :open="open" :title="t('terminal.quickCommands')" @close="$emit('close')">
    <template #header>
      <ListIcon :size="16" class="modal-header-icon" />
      <span class="modal-title">{{ t('terminal.quickCommands') }}</span>
    </template>

    <div class="qc-content">
      <!-- Command list with drag-to-reorder -->
      <div v-if="commands.length > 0" class="qc-list">
        <draggable
          v-model="localCommands"
          handle=".drag-handle"
          item-key="id"
          @end="onDragEnd"
        >
          <template #item="{ element: cmd }">
            <div class="qc-row" :class="{ 'qc-hidden': cmd.hidden }">
              <span class="drag-handle">≡</span>
              <span class="qc-label">
                <span v-if="cmd.auto_execute" class="qc-badge auto">🚀</span>
                <span v-if="cmd.hidden" class="qc-badge dim">👁</span>
                {{ cmd.label }}
              </span>
              <span class="qc-cmd" :title="cmd.command">{{ cmd.command }}</span>
              <button class="qc-action" @click="editCommand(cmd)" :title="t('terminal.editCommand')">
                <PencilIcon :size="14" />
              </button>
              <button class="qc-action danger" @click="confirmDelete(cmd)" :title="t('terminal.commandDeleted')">
                <Trash2Icon :size="14" />
              </button>
            </div>
          </template>
        </draggable>
      </div>
      <div v-else class="qc-empty">
        {{ t('terminal.addCommand') }}
      </div>

      <!-- Add button -->
      <button class="qc-add" @click="addNewCommand">
        <PlusIcon :size="16" />
        {{ t('terminal.addCommand') }}
      </button>
    </div>

    <template #footer>
      <button class="modal-btn" @click="$emit('close')">{{ t('common.close') }}</button>
    </template>

    <!-- Nested edit dialog -->
    <ModalDialog :open="showItemDialog" :title="editingCommand ? t('terminal.editCommand') : t('terminal.addCommand')" :z-index="2200" @close="showItemDialog = false">
      <template #header>
        <TerminalIcon :size="16" class="modal-header-icon" />
        <span class="modal-title">{{ editingCommand ? t('terminal.editCommand') : t('terminal.addCommand') }}</span>
      </template>

      <div class="qc-edit-content">
        <div class="form-group">
          <label class="form-label">{{ t('terminal.commandLabel') }} <span class="required">*</span></label>
          <input type="text" class="form-input" v-model="form.label" :placeholder="t('terminal.commandLabel')" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('terminal.commandText') }} <span class="required">*</span></label>
          <input type="text" class="form-input" v-model="form.command" :placeholder="t('terminal.commandText')" />
        </div>
        <div v-if="formError" class="form-error">{{ formError }}</div>

        <label class="form-checkbox">
          <input type="checkbox" v-model="form.hidden" />
          <span>{{ t('terminal.commandHidden') }}</span>
        </label>
        <label class="form-checkbox">
          <input type="checkbox" v-model="form.auto_execute" @change="onAutoExecuteChange" />
          <span>{{ t('terminal.commandAutoExecute') }}</span>
        </label>
        <div v-if="autoExecuteWarning" class="form-hint">{{ t('terminal.autoExecuteWarning') }}</div>
      </div>

      <template #footer>
        <button class="modal-btn" @click="showItemDialog = false">{{ t('common.cancel') }}</button>
        <button class="modal-btn primary" @click="saveCommand">{{ t('common.save') }}</button>
      </template>
    </ModalDialog>
  </ModalDialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import draggable from 'vuedraggable'
import ModalDialog from '@/components/common/ModalDialog.vue'
import { ListIcon, PencilIcon, Trash2Icon, PlusIcon, Terminal as TerminalIcon } from 'lucide-vue-next'
import { useQuickCommands } from '@/composables/useQuickCommands'

const props = defineProps({
  open: Boolean,
})

defineEmits(['close'])

const { t } = useI18n()
const { commands, reorderCommands, addCommand, updateCommand, deleteCommand } = useQuickCommands()

const localCommands = ref([...commands.value])

// Sync local list when commands change
watch(commands, (val) => {
  localCommands.value = [...val]
}, { deep: true })

// Edit dialog state
const showItemDialog = ref(false)
const editingCommand = ref(null)
const form = ref({ label: '', command: '', hidden: false, auto_execute: false })
const formError = ref('')
const autoExecuteWarning = ref(false)

function editCommand(cmd) {
  editingCommand.value = cmd
  form.value = { label: cmd.label, command: cmd.command, hidden: cmd.hidden, auto_execute: cmd.auto_execute }
  formError.value = ''
  autoExecuteWarning.value = false
  showItemDialog.value = true
}

function addNewCommand() {
  editingCommand.value = null
  form.value = { label: '', command: '', hidden: false, auto_execute: false }
  formError.value = ''
  autoExecuteWarning.value = false
  showItemDialog.value = true
}

function onAutoExecuteChange() {
  if (form.value.auto_execute) {
    autoExecuteWarning.value = true
  } else {
    autoExecuteWarning.value = false
  }
}

async function saveCommand() {
  const label = form.value.label.trim()
  const command = form.value.command.trim()
  if (!label || !command) {
    formError.value = t('terminal.commandRequired')
    return
  }
  formError.value = ''

  try {
    if (editingCommand.value) {
      await updateCommand(editingCommand.value.id, { label, command, hidden: form.value.hidden, auto_execute: form.value.auto_execute })
    } else {
      await addCommand({ label, command, hidden: form.value.hidden, auto_execute: form.value.auto_execute })
    }
    showItemDialog.value = false
  } catch {
    // Error already handled in composable
  }
}

async function confirmDelete(cmd) {
  if (confirm(t('terminal.deleteConfirm'))) {
    await deleteCommand(cmd.id)
  }
}

function onDragEnd() {
  const ids = localCommands.value.map(c => c.id)
  reorderCommands(ids)
}
</script>

<style>
.qc-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.qc-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.qc-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color, #e5e5e5);
  font-size: 13px;
  color: var(--text-primary);
  transition: background 0.12s;
}

.qc-row:last-child {
  border-bottom: none;
}

.qc-row.qc-hidden {
  opacity: 0.55;
}

.qc-row:hover {
  background: var(--bg-tertiary, #f5f5f5);
}

.drag-handle {
  cursor: grab;
  color: var(--text-muted, #999);
  font-size: 16px;
  line-height: 1;
  user-select: none;
  padding: 0 2px;
}

.drag-handle:active {
  cursor: grabbing;
}

.qc-label {
  flex-shrink: 0;
  font-weight: 500;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qc-badge {
  font-size: 11px;
  margin-right: 2px;
}

.qc-badge.auto {
  /* 🚀 */
}

.qc-badge.dim {
  /* 👁 */
}

.qc-cmd {
  flex: 1;
  min-width: 0;
  color: var(--text-muted, #999);
  font-family: monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qc-action {
  background: none;
  border: none;
  color: var(--text-muted, #999);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  border-radius: 4px;
  transition: background 0.12s, color 0.12s;
}

.qc-action:hover {
  background: var(--bg-tertiary, #f0f0f0);
  color: var(--text-primary);
}

.qc-action.danger:hover {
  color: #e53e3e;
}

.qc-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-muted, #999);
  font-size: 13px;
}

.qc-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  margin: 4px 10px 10px;
  border: 1px dashed var(--border-color, #ddd);
  border-radius: 8px;
  background: none;
  color: var(--accent-color, #0066cc);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
}

.qc-add:hover {
  background: color-mix(in srgb, var(--accent-color, #0066cc) 8%, transparent);
}

.qc-edit-content {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #666);
}

.form-label .required {
  color: #e53e3e;
}

.form-input {
  padding: 8px 10px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s;
}

.form-input:focus {
  border-color: var(--accent-color, #0066cc);
}

.form-error {
  font-size: 12px;
  color: #e53e3e;
}

.form-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}

.form-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-color, #0066cc);
}

.form-hint {
  font-size: 11px;
  color: var(--text-muted, #999);
  padding-left: 24px;
}

.modal-btn {
  padding: 6px 16px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
}

.modal-btn:hover {
  background: var(--bg-tertiary, #f5f5f5);
}

.modal-btn.primary {
  background: var(--accent-color, #0066cc);
  color: #fff;
  border-color: var(--accent-color, #0066cc);
}

.modal-btn.primary:hover {
  opacity: 0.9;
}
</style>
