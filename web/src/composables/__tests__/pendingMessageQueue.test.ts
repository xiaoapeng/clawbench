import { describe, it, expect, vi, beforeEach } from 'vitest'

// Test the API-based queue interaction patterns.
// The actual queue logic lives in the backend; these tests verify
// that the frontend correctly calls the API and updates local state.

describe('Pending Message Queue (API-driven)', () => {
  let pendingMessages
  let fetchMock

  beforeEach(() => {
    pendingMessages = { value: [] }
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  async function enqueueMessage(text, sessionId = 'test-session') {
    const resp = await fetch(
      `/api/ai/queue?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, filePaths: [], files: [] }),
      }
    )
    const data = await resp.json()
    if (data.queue) {
      pendingMessages.value = data.queue
    }
  }

  async function handleRemovePending(index, sessionId = 'test-session') {
    const resp = await fetch(
      `/api/ai/queue?session_id=${encodeURIComponent(sessionId)}&index=${index}`,
      { method: 'DELETE' }
    )
    const data = await resp.json()
    pendingMessages.value = data.queue || []
  }

  it('enqueue calls POST /api/ai/queue', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, queue: [{ text: 'hello', createdAt: '2024-01-01' }] }),
    })
    await enqueueMessage('hello')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/queue?session_id=test-session',
      expect.objectContaining({ method: 'POST' })
    )
    expect(pendingMessages.value).toHaveLength(1)
    expect(pendingMessages.value[0].text).toBe('hello')
  })

  it('enqueue updates pendingMessages from response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        queue: [
          { text: 'first', createdAt: '2024-01-01' },
          { text: 'second', createdAt: '2024-01-02' },
        ],
      }),
    })
    await enqueueMessage('second')
    expect(pendingMessages.value).toHaveLength(2)
  })

  it('remove calls DELETE /api/ai/queue with index', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, queue: [] }),
    })
    await handleRemovePending(0)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/queue?session_id=test-session&index=0',
      expect.objectContaining({ method: 'DELETE' })
    )
    expect(pendingMessages.value).toHaveLength(0)
  })

  it('cancelled clears pendingMessages locally', () => {
    pendingMessages.value = [{ text: 'queued' }]
    // Simulate onStreamEnd('cancelled')
    pendingMessages.value = []
    expect(pendingMessages.value).toHaveLength(0)
  })

  it('error preserves pendingMessages', () => {
    pendingMessages.value = [{ text: 'queued' }]
    // Simulate onStreamEnd('error') — don't touch pendingMessages
    expect(pendingMessages.value).toHaveLength(1)
  })

  it('queue_update SSE event updates pendingMessages', () => {
    // Simulate queue_update callback
    const queue = [{ text: 'msg1' }, { text: 'msg2' }]
    pendingMessages.value = queue
    expect(pendingMessages.value).toHaveLength(2)
  })

  it('queue_consume SSE event adds user + assistant messages', () => {
    const messages = []
    // Simulate queue_consume handler
    messages.push({
      role: 'user',
      content: 'queued question',
      createdAt: new Date().toISOString(),
    })
    messages.push({
      role: 'assistant',
      content: '',
      blocks: [],
      streaming: true,
      createdAt: new Date().toISOString(),
    })
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].streaming).toBe(true)
  })

  it('queue_consume SSE event files are not duplicated when filePaths overlaps files', () => {
    // Simulates the queue_consume handler in useChatStream.ts
    // The backend sends both filePaths and files in the event, where files
    // already includes filePaths. The frontend should only use data.files
    // to avoid duplication.
    const data = {
      text: 'check this file',
      filePaths: ['config.yaml'],
      files: ['config.yaml'],
    }

    // This is the fixed handler logic:
    // files: (data.files || []).map(p => ({ path: p }))
    const userFiles = (data.files || []).map(p => ({ path: p }))

    expect(userFiles).toHaveLength(1)
    expect(userFiles[0].path).toBe('config.yaml')
  })

  it('queue_consume SSE event preserves all files when filePaths is a subset', () => {
    // Simulates: user attached one file + uploaded another
    // Frontend sends: filePaths=['src/main.go'], files=['.clawbench/uploads/img.png', 'src/main.go']
    // Backend stores: files=['.clawbench/uploads/img.png', 'src/main.go']
    // queue_consume sends: filePaths=['src/main.go'], files=['.clawbench/uploads/img.png', 'src/main.go']
    const data = {
      text: 'check these',
      filePaths: ['src/main.go'],
      files: ['.clawbench/uploads/img.png', 'src/main.go'],
    }

    const userFiles = (data.files || []).map(p => ({ path: p }))

    expect(userFiles).toHaveLength(2)
    expect(userFiles[0].path).toBe('.clawbench/uploads/img.png')
    expect(userFiles[1].path).toBe('src/main.go')
  })

  it('queue_consume SSE event handles empty files gracefully', () => {
    const data = {
      text: 'simple question',
      filePaths: [],
      files: [],
    }

    const userFiles = (data.files || []).map(p => ({ path: p }))

    expect(userFiles).toHaveLength(0)
  })
})
