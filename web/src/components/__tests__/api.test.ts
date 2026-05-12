import { describe, expect, it, vi, beforeEach } from 'vitest'

// ────────────────────────────────────────────────────────────
// api.ts functions use fetch and i18n. We mock both to test
// the error handling and header injection logic.
// ────────────────────────────────────────────────────────────

// Mock i18n
vi.mock('@/i18n', () => ({
  default: {
    global: {
      locale: { value: 'en' },
    },
  },
}))

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Import after mocks are set up
import { apiGet, apiPost, apiPut, apiDelete, cancelChat } from '@/utils/api.ts'

beforeEach(() => {
  mockFetch.mockReset()
})

// Helper: match fetch calls that include an AbortSignal
// (signal is an AbortSignal instance, so we use expect.any(AbortSignal))
function expectFetchCalledWith(url: string, opts: Record<string, unknown>) {
  expect(mockFetch).toHaveBeenCalledWith(url, {
    ...opts,
    signal: expect.any(AbortSignal),
  })
}

describe('apiGet', () => {
  it('makes GET request with locale header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
    })

    const result = await apiGet('/api/test')
    expectFetchCalledWith('/api/test', {
      headers: { 'X-Locale': 'en' },
    })
    expect(result).toEqual({ data: 'test' })
  })

  it('throws error on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('Not Found'),
    })

    await expect(apiGet('/api/missing')).rejects.toThrow('Not Found')
  })
})

describe('apiPost', () => {
  it('makes POST request with JSON body and locale header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, sessionId: '123' }),
    })

    const result = await apiPost('/api/test', { name: 'test' })
    expectFetchCalledWith('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Locale': 'en' },
      body: JSON.stringify({ name: 'test' }),
    })
    expect(result).toEqual({ ok: true, sessionId: '123' })
  })

  it('throws error with data.error message on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Session not found' }),
    })

    await expect(apiPost('/api/test', {})).rejects.toThrow('Session not found')
  })

  it('throws with statusText when no error field', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: () => Promise.resolve({}),
    })

    await expect(apiPost('/api/test', {})).rejects.toThrow('Bad Request')
  })

  it('handles JSON parse failure in error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('Invalid JSON')),
    })

    await expect(apiPost('/api/test', {})).rejects.toThrow('Internal Server Error')
  })
})

describe('apiDelete', () => {
  it('makes DELETE request with locale header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    })

    const result = await apiDelete('/api/test/123')
    expectFetchCalledWith('/api/test/123', {
      method: 'DELETE',
      headers: { 'X-Locale': 'en' },
    })
    expect(result).toEqual({ ok: true })
  })

  it('throws error on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Forbidden',
    })

    await expect(apiDelete('/api/test/123')).rejects.toThrow('Forbidden')
  })
})

describe('cancelChat', () => {
  it('makes POST request to cancel endpoint', async () => {
    mockFetch.mockResolvedValue({ ok: true })

    await cancelChat('session-123')
    expectFetchCalledWith(
      '/api/ai/chat/cancel?session_id=session-123',
      {
        method: 'POST',
        headers: { 'X-Locale': 'en' },
      },
    )
  })

  it('encodes session ID with special characters', async () => {
    mockFetch.mockResolvedValue({ ok: true })

    await cancelChat('session/with+special')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai/chat/cancel?session_id=session%2Fwith%2Bspecial',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-Locale': 'en' },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('throws error on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
    })

    await expect(cancelChat('bad-session')).rejects.toThrow('Not Found')
  })
})

// ── External AbortSignal support ──

describe('apiGet with signal', () => {
  it('passes external signal to fetch call', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
    })

    const externalController = new AbortController()
    await apiGet('/api/test', { signal: externalController.signal })

    // The signal passed to fetch should be an AbortSignal (our merged one)
    expect(mockFetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
  })

  it('rejects immediately when external signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(apiGet('/api/test', { signal: controller.signal })).rejects.toThrow()
  })
})

describe('apiPut', () => {
  it('makes PUT request with JSON body and locale header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ task: { id: '1' } }),
    })

    const result = await apiPut('/api/tasks/1', { action: 'pause' })
    expectFetchCalledWith('/api/tasks/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Locale': 'en' },
      body: JSON.stringify({ action: 'pause' }),
    })
    expect(result).toEqual({ task: { id: '1' } })
  })

  it('throws error with data.error message on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Invalid cron' }),
    })

    await expect(apiPut('/api/tasks/1', {})).rejects.toThrow('Invalid cron')
  })

  it('forwards external signal to fetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })

    const externalSignal = new AbortController().signal
    await apiPut('/api/tasks/1', { action: 'trigger' }, { signal: externalSignal })

    expect(mockFetch).toHaveBeenCalledWith('/api/tasks/1', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
  })
})

describe('apiPost with signal', () => {
  it('forwards external signal to fetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ task: { id: 'new' } }),
    })

    const externalSignal = new AbortController().signal
    await apiPost('/api/tasks', { name: 'test' }, { signal: externalSignal })

    expect(mockFetch).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
  })
})

describe('apiDelete with signal', () => {
  it('forwards external signal to fetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })

    const externalSignal = new AbortController().signal
    await apiDelete('/api/tasks/1', { signal: externalSignal })

    expect(mockFetch).toHaveBeenCalledWith('/api/tasks/1', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
  })
})
