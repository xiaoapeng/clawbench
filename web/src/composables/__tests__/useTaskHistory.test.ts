import { describe, expect, it, vi, beforeEach } from 'vitest'

// ────────────────────────────────────────────────────────────
// useTaskHistory composable tests
// Tests ISS-011 (raw fetch → apiGet/apiPut), ISS-015 (locallyReadIds
// to prevent unread flash-back), ISS-016 (AbortController on task change)
// ────────────────────────────────────────────────────────────

// Mock i18n
vi.mock('@/i18n', () => ({
  default: {
    global: {
      locale: { value: 'en' },
      t: (key: string) => key,
    },
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

// Mock API helpers
const mockApiGet = vi.fn()
const mockApiPut = vi.fn()
vi.mock('@/utils/api.ts', () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
  apiPut: (...args: unknown[]) => mockApiPut(...args),
}))

// Mock composables
const mockToastShow = vi.fn()
vi.mock('@/composables/useToast.ts', () => ({
  useToast: () => ({ show: mockToastShow }),
}))

const mockDialogConfirm = vi.fn()
vi.mock('@/composables/useDialog.ts', () => ({
  useDialog: () => ({ confirm: mockDialogConfirm }),
}))

const mockOpenExecDetail = vi.fn()
const mockLoadTasks = vi.fn()
vi.mock('@/composables/useTaskTab.ts', () => ({
  useTaskTab: () => ({
    openExecDetail: mockOpenExecDetail,
    loadTasks: mockLoadTasks,
  }),
}))

vi.mock('@/composables/useChatRender.ts', () => ({
  useChatRender: () => ({
    parseAssistantContent: (content: string) => ({
      blocks: [{ type: 'text', text: content }],
      metadata: null,
    }),
    formatMessageTime: () => '2m ago',
  }),
}))

// Import after mocks
import { useTaskHistory } from '@/composables/useTaskHistory.ts'
import { ref, nextTick } from 'vue'

beforeEach(() => {
  mockApiGet.mockReset()
  mockApiPut.mockReset()
  mockToastShow.mockReset()
  mockDialogConfirm.mockReset()
  mockOpenExecDetail.mockReset()
})

// ── Helper ──

function createHistory(taskData: any = { id: 'task-1' }) {
  const task = ref(taskData)

  const history = useTaskHistory({ task })

  return { history, task }
}

// ── Tests ──

describe('useTaskHistory', () => {
  describe('loadExecutions', () => {
    it('calls apiGet with task id', async () => {
      const { history } = createHistory()
      mockApiGet.mockResolvedValue({ executions: [] })

      await history.loadExecutions()

      expect(mockApiGet).toHaveBeenCalledWith('/api/tasks/task-1/executions', expect.objectContaining({}))
    })

    it('populates executions with parsed data', async () => {
      const { history } = createHistory()
      mockApiGet.mockResolvedValue({
        executions: [
          { id: 'e1', content: 'Hello', createdAt: '2026-01-01', isUnread: true },
        ],
      })

      await history.loadExecutions()

      expect(history.executions.value.length).toBe(1)
      expect(history.executions.value[0].id).toBe('e1')
    })
  })

  describe('loadRunningStatus', () => {
    it('calls apiGet with task id', async () => {
      const { history } = createHistory()
      mockApiGet.mockResolvedValue({ runningExecutions: [] })

      await history.loadRunningStatus()

      expect(mockApiGet).toHaveBeenCalledWith('/api/tasks/task-1', expect.objectContaining({}))
    })
  })

  describe('cancelExecution', () => {
    it('calls apiPut with cancel action', async () => {
      const { history } = createHistory()
      mockDialogConfirm.mockResolvedValue(true)
      mockApiPut.mockResolvedValue({})

      await history.cancelExecution('exec-1')

      expect(mockApiPut).toHaveBeenCalledWith('/api/tasks/task-1', {
        action: 'cancel',
        executionId: 'exec-1',
      })
    })

    it('shows success toast on ok', async () => {
      const { history } = createHistory()
      mockDialogConfirm.mockResolvedValue(true)
      mockApiPut.mockResolvedValue({})

      await history.cancelExecution('exec-1')

      expect(mockToastShow).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ type: 'success' }))
    })

    it('does not cancel if dialog denied', async () => {
      const { history } = createHistory()
      mockDialogConfirm.mockResolvedValue(false)

      await history.cancelExecution('exec-1')

      expect(mockApiPut).not.toHaveBeenCalled()
    })
  })

  describe('markExecRead', () => {
    it('calls apiPut with read action', async () => {
      const { history } = createHistory()
      mockApiPut.mockResolvedValue({})

      await history.markExecRead('exec-1')

      expect(mockApiPut).toHaveBeenCalledWith('/api/tasks/task-1', {
        action: 'read',
        executionId: 'exec-1',
      })
    })

    it('silently ignores errors', async () => {
      const { history } = createHistory()
      mockApiPut.mockRejectedValue(new Error('Failed'))

      // Should not throw
      await history.markExecRead('exec-1')
    })
  })

  describe('openDetail — ISS-015: locallyReadIds', () => {
    it('marks execution as locally read', async () => {
      const { history } = createHistory()
      mockApiGet.mockResolvedValue({
        executions: [{ id: 'e1', content: 'Hello', createdAt: '2026-01-01', isUnread: true }],
      })
      mockApiPut.mockResolvedValue({})

      await history.loadExecutions()

      history.openDetail(history.executions.value[0])

      expect(history.locallyReadIds.has('e1')).toBe(true)
    })

    it('does not re-mark already locally-read execution', async () => {
      const { history } = createHistory()
      mockApiGet.mockResolvedValue({
        executions: [{ id: 'e1', content: 'Hello', createdAt: '2026-01-01', isUnread: true }],
      })
      mockApiPut.mockResolvedValue({})

      await history.loadExecutions()

      history.openDetail(history.executions.value[0])
      expect(mockApiPut).toHaveBeenCalledTimes(1) // read mark

      mockApiPut.mockClear()
      history.openDetail(history.executions.value[0])
      expect(mockApiPut).not.toHaveBeenCalled() // not called again
    })

    it('isUnreadDisplay returns false after local read even if server says unread', async () => {
      const { history } = createHistory()
      mockApiGet.mockResolvedValue({
        executions: [{ id: 'e1', content: 'Hello', createdAt: '2026-01-01', isUnread: true }],
      })
      mockApiPut.mockResolvedValue({})

      await history.loadExecutions()
      history.openDetail(history.executions.value[0])

      expect(history.isUnreadDisplay(history.executions.value[0])).toBe(false)
    })
  })

  describe('AbortController — ISS-016', () => {
    it('provides a signal that changes when task ID changes', async () => {
      const { history, task } = createHistory()
      const signal1 = history.getSignal()

      // Change task ID
      task.value = { id: 'task-2' }
      history.onTaskChange()

      const signal2 = history.getSignal()
      expect(signal1).not.toBe(signal2)
    })
  })
})
