<template>
  <Teleport to="body">
    <div v-show="open" class="modal-overlay" :style="{ zIndex }" @click.self="$emit('close')">
      <div class="modal-dialog" @click.stop>
        <div class="modal-header" @click="$emit('close')">
          <slot name="header">
            <span class="modal-title">{{ title }}</span>
          </slot>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </div>
        <slot name="after" />
      </div>
    </div>
  </Teleport>
</template>

<script setup>
defineProps({
  open: Boolean,
  title: { type: String, default: '' },
  zIndex: { type: Number, default: 2100 },
})

defineEmits(['close'])
</script>

<style>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  z-index: 2100;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 44px 2px 48px;
}

.modal-dialog {
  background: var(--bg-secondary, #fff);
  border-radius: 8px;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color, #e5e5e5);
  flex-shrink: 0;
  cursor: pointer;
}

.modal-header-icon {
  flex-shrink: 0;
  color: var(--text-primary, #1a1a1a);
  display: flex;
  align-items: center;
}

.modal-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary, #1a1a1a);
}

.modal-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--border-color, #e5e5e5);
  flex-shrink: 0;
  justify-content: flex-end;
}
</style>
