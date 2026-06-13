<template>
  <div class="terminal-panel" :style="panelStyle">
    <!-- Tab bar (replaces old header) -->
    <div class="terminal-tab-bar">
      <div class="terminal-tab-list">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="terminal-tab"
          :class="{ active: tab.id === activeTabId }"
          @click="handleTabClick(tab.id)"
        >
          <span class="terminal-tab-title" :title="tab.cwd">{{ tab.title }}</span>
          <span class="terminal-tab-status" :class="tab.session.connectionState"></span>
          <button class="terminal-tab-menu-btn" @click.stop="openTabMenu($event, tab)" :title="t('terminal.title')">
            <MoreVerticalIcon :size="12" />
          </button>
        </div>
      </div>
      <button
        class="terminal-tab-add"
        :class="{ disabled: !canCreateMore }"
        :disabled="!canCreateMore"
        @click="handleCreateTab"
        :title="canCreateMore ? t('terminal.newTab') : t('terminal.tabLimitReached')"
      >
        <PlusIcon :size="14" />
      </button>
    </div>

    <!-- Terminal viewport — one container per tab -->
    <div class="terminal-viewport">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        v-show="tab.id === activeTabId"
        :ref="(el) => setTabContainer(tab.id, el as HTMLElement | null)"
        class="terminal-container"
        @click.self="focusTerminal"
      >
        <!-- Rebuild overlay (per-tab) -->
        <div v-if="rebuildingTabId === tab.id" class="terminal-rebuild-overlay">
          <span class="terminal-rebuild-spinner"></span>
          <span>{{ t('terminal.rebuilding') }}</span>
        </div>

        <!-- Error overlay (per-tab) -->
        <div v-if="tab.id === activeTabId && isTabError(tab)" class="terminal-error-overlay">
          <p>{{ getTabErrorMessage(tab) }}</p>
          <button v-if="isTabCanReconnect(tab)" class="terminal-reconnect-btn" @click="handleReconnect(tab)">{{ t('terminal.reconnect') }}</button>
        </div>

        <!-- Gesture hint overlay -->
        <Transition name="gesture-hint">
          <div v-if="gestureHint" class="gesture-hint">{{ gestureHint }}</div>
        </Transition>
      </div>
    </div>

    <!-- Virtual key toolbar -->
    <div class="terminal-toolbar">
      <!-- Symbol bar (toggleable, above main toolbar) -->
      <div v-if="showSymbolBar" class="symbol-bar">
        <div class="symbol-bar-scroll">
          <button v-for="sym in symbolKeys" :key="sym" class="toolbar-btn btn-symbol" @click="handleSymbolClick(sym)">{{ sym }}</button>
        </div>
      </div>

      <!-- Main toolbar row -->
      <div class="main-toolbar-row">
        <button class="toolbar-btn modifier gesture-toggle" :class="{ active: gestures.enabled.value }" @click="gestures.toggle(); focusTerminal()" @contextmenu.prevent :title="t('terminal.gestures')">
          <HandIcon :size="14" />
        </button>
        <button class="toolbar-btn modifier gesture-toggle" :class="{ active: showSymbolBar }" @click="toggleSymbolBar()" @contextmenu.prevent :title="t('terminal.symbols')">
          <HashIcon :size="14" />
        </button>
        <div class="toolbar-scroll">
          <!-- Group: Modifiers -->
          <div class="key-group">
            <button class="toolbar-btn btn-modifier" @click="terminalKeys.sendEscape(); focusTerminal()" title="Esc">Esc</button>
            <button v-if="!gestures.enabled.value" class="toolbar-btn btn-modifier" @click="terminalKeys.sendTab(); focusTerminal()" title="Tab">Tab</button>
            <button class="toolbar-btn btn-modifier modifier" :class="{ active: terminalKeys.activeModifiers.value.ctrl !== 'inactive', locked: terminalKeys.activeModifiers.value.ctrl === 'locked' }" @click="handleModifier('ctrl')" @contextmenu.prevent title="Ctrl">Ctl</button>
            <button class="toolbar-btn btn-modifier modifier" :class="{ active: terminalKeys.activeModifiers.value.alt !== 'inactive', locked: terminalKeys.activeModifiers.value.alt === 'locked' }" @click="handleModifier('alt')" @contextmenu.prevent title="Alt">Alt</button>
            <button class="toolbar-btn btn-modifier modifier" :class="{ active: terminalKeys.activeModifiers.value.shift !== 'inactive', locked: terminalKeys.activeModifiers.value.shift === 'locked' }" @click="handleModifier('shift')" @contextmenu.prevent title="Shift"><ShiftIcon :size="14" /></button>
          </div>
          <!-- Group: Shortcuts (Ctrl+C / Ctrl+Z) -->
          <div class="key-group">
            <button class="toolbar-btn btn-modifier shortcut" @click="terminalKeys.sendCtrlC(); focusTerminal()" title="Ctrl+C">⌃C</button>
            <button class="toolbar-btn btn-modifier shortcut" @click="terminalKeys.sendCtrlZ(); focusTerminal()" title="Ctrl+Z">⌃Z</button>
          </div>
          <!-- Group: Navigation -->
          <div class="key-group">
            <button class="toolbar-btn btn-nav" @click="terminalKeys.sendHome(); focusTerminal()" title="Home">Home</button>
            <button class="toolbar-btn btn-nav" @click="terminalKeys.sendEnd(); focusTerminal()" title="End">End</button>
            <button v-if="!gestures.enabled.value" class="toolbar-btn btn-nav" @click="terminalKeys.sendPageUp(); focusTerminal()" title="Page Up">PgUp</button>
            <button v-if="!gestures.enabled.value" class="toolbar-btn btn-nav" @click="terminalKeys.sendPageDown(); focusTerminal()" title="Page Down">PgDn</button>
          </div>
          <!-- Group: Arrow keys -->
          <div v-show="!gestures.enabled.value" class="key-group">
            <button class="toolbar-btn btn-arrow" @click="terminalKeys.sendArrowUp(); focusTerminal()" title="↑">↑</button>
            <button class="toolbar-btn btn-arrow" @click="terminalKeys.sendArrowDown(); focusTerminal()" title="↓">↓</button>
            <button class="toolbar-btn btn-arrow" @click="terminalKeys.sendArrowLeft(); focusTerminal()" title="←">←</button>
            <button class="toolbar-btn btn-arrow" @click="terminalKeys.sendArrowRight(); focusTerminal()" title="→">→</button>
          </div>
          <!-- Group: Actions -->
          <div class="key-group">
            <button ref="cmdBtnRef" class="toolbar-btn btn-action" @click="showCommands = !showCommands" :title="t('terminal.quickCommands')">
              <ZapIcon :size="14" />
            </button>
            <button class="toolbar-btn btn-action" @click="handleCopyOutput" :title="t('terminal.copyOutput')">
              <CopyIcon :size="14" />
            </button>
            <button class="toolbar-btn btn-action" @click="handleRebuild" :title="t('terminal.rebuildSession')">
              <RefreshCwIcon :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick commands popup -->
    <PopupMenu v-model:show="showCommands" :target-element="cmdBtnRef" :max-width="220" :max-height="280" :menu-items-count="visibleCommands.length + 1">
      <div class="quick-send-title">{{ t('terminal.quickCommands') }}</div>
      <button v-for="cmd in visibleCommands" :key="cmd.id" class="quick-send-item" @click="executeCommand(cmd)">
        {{ cmd.label }}
      </button>
      <div class="quick-send-divider" />
      <button class="quick-send-item" @click="openEditDialog">
        ⚙️ {{ t('terminal.editCommands') }}
      </button>
    </PopupMenu>

    <!-- Tab three-dot menu -->
    <TerminalTabMenu
      v-model:show="showTabMenu"
      :target-element="tabMenuTarget"
      :cwd="tabMenuCwd"
      @close="handleTabMenuClose"
      @copy-path="handleTabMenuCopyPath"
      @new-tab-here="handleTabMenuNewTabHere"
    />

    <!-- Quick command edit dialog — only open when terminal tab is active -->
    <QuickCommandDialog :open="props.active && showEditDialog" @close="showEditDialog = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import '@xterm/xterm/css/xterm.css'

import PopupMenu from '@/components/common/PopupMenu.vue'
import QuickCommandDialog from '@/components/terminal/QuickCommandDialog.vue'
import TerminalTabMenu from '@/components/terminal/TerminalTabMenu.vue'
import { useTerminalTabs, type TerminalTab } from '@/composables/useTerminalTabs'
import { useTerminalViewport } from '@/composables/useTerminalViewport'
import { useTerminalKeys } from '@/composables/useTerminalKeys'
import { shouldPreventTerminalContextMenu, useTerminalGestures } from '@/composables/useTerminalGestures'
import { useToast } from '@/composables/useToast'
import { useQuickCommands } from '@/composables/useQuickCommands'
import { useAppMode } from '@/composables/useAppMode'
import { store } from '@/stores/app'
import { resolveTerminalCwd } from './terminalCwd'
import {
  DEFAULT_FONT_SIZE,
  canReconnect as canReconnectUtil,
  errorDisplayMessage as errorDisplayMessageUtil,
  showErrorOverlay as showErrorOverlayUtil,
} from '@/utils/terminalFontUtils'
import { localConfig, setLocalConfig, useSettingsConfig } from '@/composables/useSettingsConfig'
import {
  ALL_SYMBOLS,
  loadSymbolFreqs,
  saveSymbolFreqs,
  sortSymbolsByFreq as sortSymbolsByFreqUtil,
  incrementSymbolFreq,
} from '@/utils/terminalSymbolFreq'

import { Copy as CopyIcon, Zap as ZapIcon, Hand as HandIcon, RefreshCw as RefreshCwIcon, ArrowUpFromLine as ShiftIcon, Hash as HashIcon, Plus as PlusIcon, MoreVertical as MoreVerticalIcon } from 'lucide-vue-next'
const props = defineProps<{
  requestedCwd?: string | null
  active?: boolean
}>()

const emit = defineEmits<{
  open: []
  'cwd-handled': []
}>()

const { t } = useI18n()
const toast = useToast()
const { getServerValueWithDefault } = useSettingsConfig()

// Font size with persistence
const fontSize = ref<number>(localConfig.terminalFontSize || DEFAULT_FONT_SIZE)

// Max sessions from server config
const maxSessions = computed(() => {
  const val = getServerValueWithDefault('terminal.max_sessions')
  return typeof val === 'number' ? val : 10
})

function applyFontSize(size: number) {
  const MIN = 8, MAX = 28
  const clamped = Math.max(MIN, Math.min(MAX, size))
  fontSize.value = clamped
  setLocalConfig('terminalFontSize', clamped)
  tabManager.updateFontSize(clamped)
  // Fit active terminal after font change
  const active = tabManager.activeTab.value
  if (active?.fitAddon) {
    requestAnimationFrame(() => {
      try { active.fitAddon?.fit() } catch { /* ignore */ }
    })
  }
}

// Refs
const gestureHint = ref('')
let gestureHintTimer: ReturnType<typeof setTimeout> | null = null
const showCommands = ref(false)
const cmdBtnRef = ref<HTMLElement | null>(null)
const showSymbolBar = ref(false)
const rebuildingTabId = ref<string | null>(null)

// Tab menu state
const showTabMenu = ref(false)
const tabMenuTarget = ref<HTMLElement | null>(null)
const tabMenuTabId = ref<string | null>(null)
const tabMenuCwd = ref('')

// Symbol bar
const symbolKeys = ref<string[]>([...ALL_SYMBOLS])

function sortSymbolsByFreq() {
  const freqs = loadSymbolFreqs()
  const now = Date.now()
  symbolKeys.value = sortSymbolsByFreqUtil(freqs, now)
}

function handleSymbolClick(sym: string) {
  const freqs = loadSymbolFreqs()
  const now = Date.now()
  const updated = incrementSymbolFreq(freqs, sym, now)
  saveSymbolFreqs(updated)
  const active = tabManager.activeTab.value
  if (active) active.session.sendInput(sym)
  focusTerminal()
}

function toggleSymbolBar() {
  showSymbolBar.value = !showSymbolBar.value
  if (showSymbolBar.value) sortSymbolsByFreq()
  focusTerminal()
}

function computeCwd(): string {
  return resolveTerminalCwd({
    currentFilePath: store.state.currentFile?.path,
    currentDir: store.state.currentDir,
    requestedCwd: props.requestedCwd,
  })
}

// Build WS URL for a given CWD
function getWsUrl(cwd?: string) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const cwdParam = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return `${proto}//${location.host}/api/terminal/ws${cwdParam}`
}

// Theme
function getXtermTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  return isDark ? darkTheme : lightTheme
}

const darkTheme = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selectionBackground: '#585b7066',
  black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
  blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
  brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5', brightWhite: '#a6adc8',
}

const lightTheme = {
  background: '#eff1f5',
  foreground: '#4c4f69',
  cursor: '#dc8a78',
  cursorAccent: '#eff1f5',
  selectionBackground: '#acb0be66',
  black: '#bcc0cc', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d',
  blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#4c4f69',
  brightBlack: '#9ca0b0', brightRed: '#d20f39', brightGreen: '#40a02b',
  brightYellow: '#df8e1d', brightBlue: '#1e66f5', brightMagenta: '#ea76cb',
  brightCyan: '#179299', brightWhite: '#6c6f85',
}

// Tab manager
const tabManager = useTerminalTabs(getWsUrl, {
  fontSize,
  getXtermTheme,
  errorMessages: {
    shellStartFailed: t('terminal.shellStartFailed'),
    websocketFailed: t('terminal.websocketFailed'),
  },
  onCloseSessionViaHttp: (sessionId: string) => {
    fetch(`/api/terminal/close?session=${encodeURIComponent(sessionId)}`, { method: 'POST' }).catch(() => {})
  },
  onExit: (_tabId) => {
    toast.show(t('terminal.ptyExited'), { type: 'info' })
  },
  onError: () => {
    // Error displayed via overlay
  },
})

const { tabs, activeTabId, activeTab } = tabManager

// Quick commands
const {
  visibleCommands,
  fetchCommands,
  showEditDialog,
} = useQuickCommands()

// Terminal viewport — uses the active tab's xterm and container
const viewport = useTerminalViewport(
  computed(() => activeTab.value?.xterm || null),
  computed(() => activeTab.value?.container || null),
)

// Terminal keys — send to active tab
const terminalKeys = useTerminalKeys((data: string) => {
  activeTab.value?.session.sendInput(data)
})

let touchScrollRemainder = 0

function handleTerminalTouchScroll(deltaY: number) {
  const term = activeTab.value?.xterm
  if (!term) return

  const lineHeightOption = typeof term.options.lineHeight === 'number' ? term.options.lineHeight : 1
  const rowHeight = Math.max(1, fontSize.value * lineHeightOption)
  touchScrollRemainder += deltaY / rowHeight
  const lines = Math.trunc(touchScrollRemainder)
  if (lines === 0) return

  term.scrollLines(-lines)
  touchScrollRemainder -= lines
}

// Gestures
const gestures = useTerminalGestures(
  computed(() => activeTab.value?.container || null),
  {
    sendArrowUp: terminalKeys.sendArrowUp,
    sendArrowDown: terminalKeys.sendArrowDown,
    sendArrowLeft: terminalKeys.sendArrowLeft,
    sendArrowRight: terminalKeys.sendArrowRight,
    sendPageUp: terminalKeys.sendPageUp,
    sendPageDown: terminalKeys.sendPageDown,
    sendTab: terminalKeys.sendTab,
    onPinchZoom: (delta: number) => applyFontSize(fontSize.value + delta),
    onTouchScroll: handleTerminalTouchScroll,
    onGestureHint: (symbol: string) => {
      gestureHint.value = symbol
      if (gestureHintTimer) clearTimeout(gestureHintTimer)
      gestureHintTimer = setTimeout(() => { gestureHint.value = '' }, 600)
    },
  },
)

// Volume keys (Android)
const { isAppMode } = useAppMode()

function enableVolumeKeys() {
  if (!isAppMode.value) return
  const native = (window as any).AndroidNative
  if (native?.setVolumeKeyMode) native.setVolumeKeyMode(true)
}

function disableVolumeKeys() {
  if (!isAppMode.value) return
  const native = (window as any).AndroidNative
  if (native?.setVolumeKeyMode) native.setVolumeKeyMode(false)
}

;(window as any).__onVolumeKey = (direction: 'up' | 'down') => {
  if (direction === 'up') terminalKeys.sendArrowUp()
  else terminalKeys.sendArrowDown()
}

// Computed
const canCreateMore = computed(() => tabs.value.length < maxSessions.value)

// Sync terminal session count to Android notification
watch(() => tabs.value.length, (count) => {
  if (isAppMode.value) {
    try {
      const native = (window as any).AndroidNative
      if (native?.setTerminalSessionCount) native.setTerminalSessionCount(count)
    } catch { /* ignore */ }
  }
}, { immediate: true })

const panelStyle = computed(() => ({
  '--keyboard-height': `${viewport.keyboardHeight.value}px`,
}))

// Per-tab error state helpers
// NOTE: tab is a reactive() proxy which auto-unwraps Refs, so we access
// tab.session.connectionState directly (no .value) — same as in the template.
function isTabError(tab: TerminalTab): boolean {
  return showErrorOverlayUtil(tab.session.connectionState as unknown as ConnectionState)
}

function isTabCanReconnect(tab: TerminalTab): boolean {
  return canReconnectUtil(tab.session.errorCode as unknown as string)
}

function getTabErrorMessage(tab: TerminalTab): string {
  return errorDisplayMessageUtil(
    tab.session.errorCode as unknown as string,
    tab.session.errorMessage as unknown as string,
    t('terminal.websocketFailed'),
  )
}

// Tab container ref management
// We need to store container refs for each tab so xterm can mount
const tabContainerRefs = new Map<string, HTMLElement>()

function setTabContainer(tabId: string, el: HTMLElement | null) {
  if (el) {
    tabContainerRefs.set(tabId, el)
  } else {
    tabContainerRefs.delete(tabId)
  }
}

function mountTabToContainer(tab: TerminalTab, container: HTMLElement) {
  tabManager.mountTabXterm(tab, container)

  // Add Ctrl+Wheel zoom handler
  const wheelHandler = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY < 0 ? 1 : -1
      applyFontSize(fontSize.value + delta)
    }
  }
  container.addEventListener('wheel', wheelHandler, { passive: false })
  ;(container as any).__terminalWheelHandler = wheelHandler

  // Context menu handler
  const contextMenuHandler = (e: Event) => {
    if (shouldPreventTerminalContextMenu(gestures.enabled.value)) {
      e.preventDefault()
    }
  }
  container.addEventListener('contextmenu', contextMenuHandler)
  ;(container as any).__terminalContextMenuHandler = contextMenuHandler

  // Fit the terminal after mounting
  requestAnimationFrame(() => {
    try { tab.fitAddon?.fit() } catch { /* ignore */ }
  })
}

function focusTerminal() {
  activeTab.value?.xterm?.focus()
}

// Tab bar actions
function handleTabClick(tabId: string) {
  if (tabId === activeTabId.value) return
  tabManager.switchTab(tabId)

  // Connect the newly active tab if it's disconnected (e.g. after panel reactivation)
  const tab = tabManager.getTab(tabId)
  if (tab && tab.session.connectionState === 'disconnected') {
    tab.session.connect().then(() => {
      tabManager.syncTabSessionId(tabId)
      requestAnimationFrame(() => {
        try { tab.fitAddon?.fit() } catch { /* ignore */ }
      })
    }).catch(() => { /* error shown via overlay */ })
  }
}

function handleCreateTab() {
  if (!canCreateMore.value) return
  // Default new tab uses project root (empty cwd), not current directory
  const tab = tabManager.createTab()
  // Mount the new tab's xterm after next tick (DOM needs to render the container)
  nextTick(() => {
    const container = tabContainerRefs.get(tab.id)
    if (container && !tab.container) {
      mountTabToContainer(tab, container)
    }
    // Connect the new tab
    if (props.active && tab.session.connectionState === 'disconnected') {
      tab.session.connect().then(() => {
        tabManager.syncTabSessionId(tab.id)
        requestAnimationFrame(() => {
          try { tab.fitAddon?.fit() } catch { /* ignore */ }
        })
      }).catch(() => { /* error shown via overlay */ })
    }
  })
}

// Tab three-dot menu
function openTabMenu(event: Event, tab: TerminalTab) {
  event.stopPropagation()
  tabMenuTabId.value = tab.id
  tabMenuCwd.value = tab.cwd
  tabMenuTarget.value = (event.currentTarget as HTMLElement)
  showTabMenu.value = true
}

function handleTabMenuClose() {
  const tabId = tabMenuTabId.value
  if (!tabId) return
  const result = tabManager.closeTab(tabId)
  if (result.switchToId) {
    // If a new tab was auto-created, mount its xterm
    nextTick(() => {
      const container = tabContainerRefs.get(result.switchToId!)
      const tab = tabManager.getTab(result.switchToId!)
      if (container && tab && !tab.container) {
        mountTabToContainer(tab, container)
      }
      if (props.active && tab && tab.session.connectionState === 'disconnected') {
        tab.session.connect().then(() => {
          tabManager.syncTabSessionId(tab.id)
          requestAnimationFrame(() => {
            try { tab.fitAddon?.fit() } catch { /* ignore */ }
          })
        }).catch(() => {})
      }
    })
  }
  focusTerminal()
}

function handleTabMenuCopyPath() {
  // Already handled by TerminalTabMenu
}

function handleTabMenuNewTabHere() {
  const cwd = tabMenuCwd.value
  if (!canCreateMore.value) return
  const tab = tabManager.createTab(cwd || undefined)
  nextTick(() => {
    const container = tabContainerRefs.get(tab.id)
    if (container && !tab.container) {
      mountTabToContainer(tab, container)
    }
    if (props.active && tab.session.connectionState === 'disconnected') {
      tab.session.connect().then(() => {
        tabManager.syncTabSessionId(tab.id)
        requestAnimationFrame(() => {
          try { tab.fitAddon?.fit() } catch { /* ignore */ }
        })
      }).catch(() => {})
    }
  })
}

// Reconnect for a specific tab
function handleReconnect(tab: TerminalTab) {
  tab.session.disconnect()
  tab.session.connect().then(() => {
    tabManager.syncTabSessionId(tab.id)
    focusTerminal()
  }).catch(() => { /* error shown via overlay */ })
}

// Rebuild (re-create) the active tab's session
async function handleRebuild() {
  const tab = activeTab.value
  if (!tab) return

  terminalKeys.reset()
  showCommands.value = false
  rebuildingTabId.value = tab.id

  // Close specific session via HTTP API
  try {
    const sid = tab.session.sessionId
    const url = sid ? `/api/terminal/close?session=${encodeURIComponent(sid)}` : '/api/terminal/close'
    await fetch(url, { method: 'POST' })
  } catch { /* ignore */ }

  tab.session.reset()
  if (tab.xterm) tab.xterm.clear()

  try {
    await tab.session.connect()
    tabManager.syncTabSessionId(tab.id)
    focusTerminal()
  } catch { /* error shown via overlay */ }
  finally {
    rebuildingTabId.value = null
  }
}

// Copy output from active tab
function handleCopyOutput() {
  const term = activeTab.value?.xterm
  if (!term) return
  const buffer = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i)?.translateToString(true)
    if (line) lines.push(line)
  }
  const text = lines.filter(l => l.trim()).join('\n')
  navigator.clipboard.writeText(text).catch(() => {})
  toast.show(t('common.copied'), { type: 'success', duration: 1500 })
  focusTerminal()
}

function executeCommand(cmd: { id: number; label: string; command: string }) {
  activeTab.value?.session.sendInput(cmd.command + '\r')
  showCommands.value = false
  focusTerminal()
}

function openEditDialog() {
  showCommands.value = false
  showEditDialog.value = true
}

function handleModifier(key: 'ctrl' | 'alt' | 'shift') {
  terminalKeys.toggleModifier(key, false)
  focusTerminal()
}

// Whether the component has been mounted (DOM is available)
const isMounted = ref(false)

// Lifecycle
watch(() => props.active, async (isActive) => {
  if (!isMounted.value) return // Defer to onMounted for initial activation
  if (isActive) {
    emit('open')
    enableVolumeKeys()
    await nextTick()
    const tab = activeTab.value
    if (tab) {
      const container = tabContainerRefs.get(tab.id)
      if (container && !tab.container) {
        mountTabToContainer(tab, container)
      }
      if (tab.session.connectionState === 'disconnected') {
        try {
          await tab.session.connect()
          tabManager.syncTabSessionId(tab.id)
        } catch { /* error shown via overlay */ }
      }
      viewport.startWatching()
      gestures.attach()
      focusTerminal()
      requestAnimationFrame(() => {
        try { tab.fitAddon?.fit() } catch { /* ignore */ }
      })
    }
  } else {
    disableVolumeKeys()
    tabManager.disconnectAll()
    terminalKeys.reset()
    showCommands.value = false
    showTabMenu.value = false
    viewport.stopWatching()
    gestures.detach()
  }
})

// Watch requestedCwd — when the file manager emits "open terminal here",
// create a new tab in the specified directory.
watch(() => props.requestedCwd, async (cwd) => {
  if (!cwd || !props.active || !isMounted.value) return
  if (!canCreateMore.value) return
  const tab = tabManager.createTab(cwd)
  await nextTick()
  const container = tabContainerRefs.get(tab.id)
  if (container && !tab.container) {
    mountTabToContainer(tab, container)
  }
  if (tab.session.connectionState === 'disconnected') {
    tab.session.connect().then(() => {
      tabManager.syncTabSessionId(tab.id)
      requestAnimationFrame(() => {
        try { tab.fitAddon?.fit() } catch { /* ignore */ }
      })
    }).catch(() => { /* error shown via overlay */ })
  }
  // Signal parent to clear requestedCwd so re-triggering the same directory works
  emit('cwd-handled')
})

// Theme observer
let themeObserver: MutationObserver | null = null

onMounted(async () => {
  isMounted.value = true

  // Fetch quick commands in the background — don't block terminal setup
  fetchCommands().catch(() => { /* ignore */ })

  themeObserver = new MutationObserver(() => {
    tabManager.updateTheme(getXtermTheme())
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  // Mount and connect the active tab (only if terminal panel is active)
  if (props.active) {
    emit('open')
    enableVolumeKeys()
    const tab = activeTab.value
    if (tab) {
      const container = tabContainerRefs.get(tab.id)
      if (container && !tab.container) {
        mountTabToContainer(tab, container)
      }
      if (tab.session.connectionState === 'disconnected') {
        try {
          await tab.session.connect()
          tabManager.syncTabSessionId(tab.id)
        } catch { /* error shown via overlay */ }
      }
      viewport.startWatching()
      gestures.attach()
      focusTerminal()
      requestAnimationFrame(() => {
        try { tab.fitAddon?.fit() } catch { /* ignore */ }
      })
    }
  }
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  viewport.stopWatching()
  gestures.detach()
  disableVolumeKeys()
  delete (window as any).__onVolumeKey
  tabManager.disposeAll()
})

defineExpose({ activate: () => {}, deactivate: () => {}, keyboardHeight: viewport.keyboardHeight })
</script>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  position: relative;
}

/* Tab bar */
.terminal-tab-bar {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 4px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  position: relative;
  z-index: 2;
  gap: 0;
}

.terminal-tab-list {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding: 2px 0;
}

.terminal-tab-list::-webkit-scrollbar {
  display: none;
}

.terminal-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 10px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease;
  user-select: none;
  -webkit-user-select: none;
  max-width: 120px;
}

.terminal-tab:hover {
  background: var(--bg-tertiary);
}

.terminal-tab.active {
  background: color-mix(in srgb, var(--text-primary) 10%, transparent);
}

.terminal-tab-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.terminal-tab.active .terminal-tab-title {
  color: var(--text-primary);
  font-weight: 600;
}

.terminal-tab-status {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}

.terminal-tab-status.connected {
  background: var(--color-green);
}

.terminal-tab-status.connecting,
.terminal-tab-status.reconnecting {
  background: var(--color-yellow);
  animation: status-blink 1s ease-in-out infinite;
}

.terminal-tab-status.disconnected,
.terminal-tab-status.error {
  background: var(--text-muted);
}

.terminal-tab-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.terminal-tab:hover .terminal-tab-menu-btn,
.terminal-tab.active .terminal-tab-menu-btn {
  opacity: 1;
}

.terminal-tab-menu-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.terminal-tab-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  margin: 0 2px;
  transition: background 0.15s ease, color 0.15s ease;
}

.terminal-tab-add:hover:not(.disabled) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.terminal-tab-add.disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

@keyframes status-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* Terminal viewport container */
.terminal-viewport {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.terminal-container {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #1e1e2e;
}

.terminal-container :deep(.xterm-scrollable-element > .scrollbar.vertical),
.terminal-container :deep(.xterm-scrollbar) {
  width: 2px !important;
  right: 1px !important;
  background: transparent !important;
}

.terminal-container :deep(.xterm-scrollable-element > .scrollbar > .slider) {
  width: 2px !important;
  left: 0 !important;
  border-radius: 999px !important;
}

[data-theme="dark"] .terminal-container {
  background: #1e1e2e;
}

:root:not([data-theme="dark"]) .terminal-container {
  background: #eff1f5;
}

.terminal-rebuild-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  z-index: 8;
  user-select: none;
  -webkit-user-select: none;
}

.terminal-rebuild-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: rgba(255, 255, 255, 0.8);
  border-radius: 50%;
  animation: terminal-spin 0.6s linear infinite;
}

@keyframes terminal-spin {
  to { transform: rotate(360deg); }
}

.gesture-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 48px;
  color: rgba(255, 255, 255, 0.7);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  z-index: 5;
  user-select: none;
  -webkit-user-select: none;
}

.gesture-hint-enter-active {
  transition: opacity 0.1s ease;
}
.gesture-hint-leave-active {
  transition: opacity 0.4s ease;
}
.gesture-hint-enter-from,
.gesture-hint-leave-to {
  opacity: 0;
}

.terminal-error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  z-index: 10;
  padding: 20px;
  text-align: center;
}

.terminal-prompt-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.terminal-reconnect-btn {
  margin-top: 12px;
  padding: 6px 16px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 6px;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}

.terminal-reconnect-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Toolbar styles (unchanged) */
.terminal-toolbar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--bg-secondary);
  border-top: 1px solid color-mix(in srgb, var(--border-color) 40%, transparent);
  --toolbar-key-hover: color-mix(in srgb, var(--text-primary) 7%, transparent);
  --toolbar-key-active: color-mix(in srgb, var(--text-primary) 12%, transparent);
  --toolbar-key-text: color-mix(in srgb, var(--text-primary) 72%, transparent);
  --toolbar-key-muted: color-mix(in srgb, var(--text-muted) 72%, transparent);
  --toolbar-key-selected-bg: color-mix(in srgb, var(--text-primary) 14%, transparent);
  --toolbar-key-selected-text: var(--text-primary);
  --toolbar-divider: color-mix(in srgb, var(--border-color) 48%, transparent);
  --toolbar-scrollbar-track: color-mix(in srgb, var(--border-color) 20%, transparent);
  --toolbar-scrollbar-thumb: color-mix(in srgb, var(--text-muted) 46%, transparent);
  --toolbar-scrollbar-thumb-hover: color-mix(in srgb, var(--text-primary) 58%, transparent);
}

[data-theme="dark"] .terminal-toolbar {
  background: var(--bg-secondary);
  --toolbar-key-hover: color-mix(in srgb, var(--text-primary) 9%, transparent);
  --toolbar-key-active: color-mix(in srgb, var(--text-primary) 16%, transparent);
  --toolbar-key-text: color-mix(in srgb, var(--text-primary) 64%, transparent);
  --toolbar-key-muted: color-mix(in srgb, var(--text-muted) 64%, transparent);
  --toolbar-key-selected-bg: color-mix(in srgb, var(--text-primary) 18%, transparent);
  --toolbar-key-selected-text: var(--text-primary);
  --toolbar-divider: color-mix(in srgb, var(--border-color) 52%, transparent);
  --toolbar-scrollbar-track: color-mix(in srgb, var(--border-color) 30%, transparent);
  --toolbar-scrollbar-thumb: color-mix(in srgb, var(--text-muted) 54%, transparent);
  --toolbar-scrollbar-thumb-hover: color-mix(in srgb, var(--text-primary) 68%, transparent);
}

.symbol-bar {
  padding: 3px 6px 0;
  background: color-mix(in srgb, var(--text-primary) 3%, transparent);
  border-radius: 6px 6px 0 0;
}

.symbol-bar-scroll {
  display: flex;
  align-items: center;
  gap: 3px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: var(--toolbar-scrollbar-thumb) transparent;
}
.symbol-bar-scroll::-webkit-scrollbar { height: 2px; }
.symbol-bar-scroll::-webkit-scrollbar-track { background: transparent; }
.symbol-bar-scroll::-webkit-scrollbar-thumb { background: var(--toolbar-scrollbar-thumb); border-radius: 999px; }
.symbol-bar-scroll:hover::-webkit-scrollbar-thumb { background: var(--toolbar-scrollbar-thumb-hover); }

.main-toolbar-row {
  display: flex;
  align-items: center;
  padding: 4px 6px;
  gap: 2px;
}

.gesture-toggle { flex-shrink: 0; margin-right: 2px; }

.toolbar-scroll {
  display: flex;
  align-items: center;
  gap: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  flex: 1;
  min-width: 0;
  padding-bottom: 1px;
  scrollbar-width: thin;
  scrollbar-color: var(--toolbar-scrollbar-thumb) transparent;
}
.toolbar-scroll::-webkit-scrollbar { height: 2px; }
.toolbar-scroll::-webkit-scrollbar-track {
  background: linear-gradient(90deg, transparent 0, var(--toolbar-scrollbar-track) 14px, var(--toolbar-scrollbar-track) calc(100% - 14px), transparent 100%);
}
.toolbar-scroll::-webkit-scrollbar-thumb { background: var(--toolbar-scrollbar-thumb); border-radius: 999px; transition: background 140ms ease; }
.toolbar-scroll:hover::-webkit-scrollbar-thumb { background: var(--toolbar-scrollbar-thumb-hover); }

.key-group { display: flex; align-items: center; gap: 3px; }
.key-group + .key-group { position: relative; margin-left: 6px; }
.key-group + .key-group::before {
  content: '';
  position: absolute;
  left: -4px;
  width: 1px;
  height: 16px;
  border-radius: 999px;
  background: var(--toolbar-divider);
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 5px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--toolbar-key-text);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  transition: background 140ms ease, color 140ms ease, transform 90ms ease;
}
.toolbar-btn:hover { background: var(--toolbar-key-hover); }
.toolbar-btn:active { background: var(--toolbar-key-active); transform: translateY(1px) scale(0.98); }
.toolbar-btn:focus-visible { outline: 2px solid color-mix(in srgb, var(--text-primary) 36%, transparent); outline-offset: 2px; }
.toolbar-btn.modifier.active { background: var(--toolbar-key-selected-bg); color: var(--toolbar-key-selected-text); }
.toolbar-btn.modifier.locked { background: var(--toolbar-key-selected-bg); color: var(--toolbar-key-selected-text); box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--toolbar-key-selected-text) 36%, transparent); }
.toolbar-btn.shortcut { background: transparent; color: var(--toolbar-key-text); font-weight: 800; font-size: 11px; }
.toolbar-btn.shortcut:active { background: var(--toolbar-key-active); }
.toolbar-btn.danger { color: var(--toolbar-key-text); opacity: 0.78; }
.toolbar-btn.danger:hover { opacity: 1; background: var(--toolbar-key-hover); }
.toolbar-btn.gesture-toggle { min-width: 32px; border-radius: 9px; }

@media (max-width: 768px) {
  .main-toolbar-row { padding-bottom: max(4px, env(safe-area-inset-bottom)); }
}

@media (hover: none) {
  .toolbar-btn:hover { background: transparent; }
  .toolbar-btn.shortcut:hover { background: transparent; }
  .toolbar-btn.modifier.active:hover, .toolbar-btn.modifier.locked:hover { background: var(--toolbar-key-selected-bg); }
  .toolbar-btn:active { background: var(--toolbar-key-active); }
}

.toolbar-btn.btn-modifier, .toolbar-btn.btn-nav, .toolbar-btn.btn-arrow, .toolbar-btn.btn-symbol, .toolbar-btn.btn-action { background: transparent; }
.toolbar-btn.btn-symbol { color: var(--toolbar-key-text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 15px; font-weight: 700; }
</style>

<style>
/* Quick commands popup divider (unscoped because PopupMenu teleports to body) */
.quick-send-divider {
  height: 1px;
  background: var(--border-color);
  margin: 4px 0;
}
</style>
