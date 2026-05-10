import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock DOM APIs for clipboard utility
const mockWriteText = vi.fn()
const mockExecCommand = vi.fn()
let mockTextarea: any

beforeEach(() => {
  mockWriteText.mockReset()
  mockExecCommand.mockReset()
  mockWriteText.mockResolvedValue(undefined)
  mockExecCommand.mockReturnValue(true)

  mockTextarea = {
    value: '',
    style: { cssText: '' },
    focus: vi.fn(),
    select: vi.fn(),
  }
})

// Mock navigator.clipboard
Object.defineProperty(globalThis, 'navigator', {
  value: {
    clipboard: {
      writeText: mockWriteText,
    },
  },
  writable: true,
})

// Mock document methods
vi.stubGlobal('document', {
  createElement: vi.fn(() => mockTextarea),
  body: {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  },
  execCommand: mockExecCommand,
})

import { copyText } from '@/utils/clipboard.ts'

describe('copyText', () => {
  it('calls navigator.clipboard.writeText with the text', async () => {
    const onSuccess = vi.fn()
    copyText('hello world', onSuccess)

    expect(mockWriteText).toHaveBeenCalledWith('hello world')
    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it('calls onSuccess callback on successful copy', async () => {
    const onSuccess = vi.fn()
    copyText('test', onSuccess)

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it('uses fallback when clipboard API fails', async () => {
    mockWriteText.mockRejectedValue(new Error('Not allowed'))
    const onSuccess = vi.fn()

    copyText('test', onSuccess)

    // Should try fallback with execCommand
    await vi.waitFor(() => {
      expect(mockExecCommand).toHaveBeenCalledWith('copy')
    })
    // Since fallback succeeds (mockExecCommand returns true), onSuccess should be called
    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it('calls onError when clipboard API fails and fallback returns false', async () => {
    mockWriteText.mockRejectedValue(new Error('Not allowed'))
    mockExecCommand.mockReturnValue(false)
    const onError = vi.fn()

    copyText('test', undefined, onError)

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled()
    })
  })

  it('calls onError when clipboard API fails and fallback throws', async () => {
    mockWriteText.mockRejectedValue(new Error('Not allowed'))
    mockExecCommand.mockImplementation(() => { throw new Error('exec failed') })
    const onError = vi.fn()

    copyText('test', undefined, onError)

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled()
    })
  })

  it('uses fallback when navigator.clipboard is not available', async () => {
    // Save and remove clipboard
    const originalClipboard = globalThis.navigator.clipboard
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: undefined,
      writable: true,
    })

    const onSuccess = vi.fn()
    copyText('test', onSuccess)

    expect(mockExecCommand).toHaveBeenCalledWith('copy')
    // Restore
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
    })
  })

  it('works without callbacks', async () => {
    copyText('test')
    expect(mockWriteText).toHaveBeenCalledWith('test')
  })

  it('handles empty string', async () => {
    const onSuccess = vi.fn()
    copyText('', onSuccess)

    expect(mockWriteText).toHaveBeenCalledWith('')
    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it('handles special characters in text', async () => {
    copyText('hello <world> & "quotes"')
    expect(mockWriteText).toHaveBeenCalledWith('hello <world> & "quotes"')
  })

  it('handles long text', async () => {
    const longText = 'x'.repeat(10000)
    copyText(longText)
    expect(mockWriteText).toHaveBeenCalledWith(longText)
  })
})
