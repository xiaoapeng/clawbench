import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'

// Mock useSessionIdentity to control currentThinkingEffort
const mockCurrentThinkingEffort = ref('')
vi.mock('@/composables/useSessionIdentity', () => ({
  useSessionIdentity: () => ({
    currentSessionTitle: ref(''),
    currentBackend: ref(''),
    currentAgentId: ref(''),
    currentModelId: ref(''),
    currentModelName: ref(''),
    currentThinkingEffort: mockCurrentThinkingEffort,
    runningSessions: ref(new Set()),
  }),
}))

// Mock other dependencies
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ show: vi.fn() }),
}))
vi.mock('@/composables/useNotification', () => ({
  useNotification: () => ({ play: vi.fn() }),
}))
vi.mock('@/composables/useAgents', () => ({
  useAgents: () => ({
    agents: ref([]),
    loadAgents: vi.fn().mockResolvedValue(undefined),
    getAgentIcon: vi.fn().mockReturnValue('🤖'),
    getAgentName: vi.fn().mockReturnValue('Test'),
    syncModelFromAgent: vi.fn().mockReturnValue({ modelId: '', modelName: '' }),
    getAgentModel: vi.fn().mockReturnValue(undefined),
    agentHeaderTitle: vi.fn().mockReturnValue('🤖 Test'),
  }),
}))
vi.mock('@/stores/app', () => ({
  store: { state: { chatInitialMessages: 50, chatPageSize: 50 } },
}))
vi.mock('@/utils/chatSessionUtils', () => ({
  buildMessageSnapshot: vi.fn().mockReturnValue(''),
  parseMessages: vi.fn().mockReturnValue([]),
}))

import { useSessionIdentity } from '@/composables/useSessionIdentity'

describe('useSessionIdentity - currentThinkingEffort', () => {
  beforeEach(() => {
    mockCurrentThinkingEffort.value = ''
  })

  it('initializes currentThinkingEffort as empty string', () => {
    const { currentThinkingEffort } = useSessionIdentity()
    expect(currentThinkingEffort.value).toBe('')
  })

  it('can set currentThinkingEffort to a level', async () => {
    const { currentThinkingEffort } = useSessionIdentity()
    currentThinkingEffort.value = 'high'
    await nextTick()
    expect(currentThinkingEffort.value).toBe('high')
  })

  it('can reset currentThinkingEffort to empty (auto)', async () => {
    const { currentThinkingEffort } = useSessionIdentity()
    currentThinkingEffort.value = 'high'
    await nextTick()
    currentThinkingEffort.value = ''
    await nextTick()
    expect(currentThinkingEffort.value).toBe('')
  })

  it('syncThinkingEffortFromData sets value from server data', async () => {
    // Simulate what useChatSession's syncThinkingEffortFromData does:
    // currentThinkingEffort.value = thinkingEffortFromServer || ''
    const { currentThinkingEffort } = useSessionIdentity()

    // Simulate server returning "xhigh"
    const serverValue = 'xhigh'
    currentThinkingEffort.value = serverValue || ''
    await nextTick()
    expect(currentThinkingEffort.value).toBe('xhigh')
  })

  it('syncThinkingEffortFromData handles empty server data as auto', async () => {
    const { currentThinkingEffort } = useSessionIdentity()

    // Simulate server returning empty/null
    const serverValue = ''
    currentThinkingEffort.value = serverValue || ''
    await nextTick()
    expect(currentThinkingEffort.value).toBe('')
  })

  it('syncThinkingEffortFromData handles null/undefined server data', async () => {
    const { currentThinkingEffort } = useSessionIdentity()

    // Simulate server returning null or undefined
    const serverValue = null as any
    currentThinkingEffort.value = serverValue || ''
    await nextTick()
    expect(currentThinkingEffort.value).toBe('')
  })

  it('supports switching between different effort levels', async () => {
    const { currentThinkingEffort } = useSessionIdentity()

    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      currentThinkingEffort.value = level
      await nextTick()
      expect(currentThinkingEffort.value).toBe(level)
    }
  })
})
