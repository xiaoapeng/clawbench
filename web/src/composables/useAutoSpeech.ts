/**
 * useAutoSpeech
 *
 * Manages the auto-speech toggle state and audio playback for AI messages.
 * When enabled, AI replies are automatically summarized and read aloud via TTS.
 * Toggle state is persisted in localStorage.
 *
 * Uses module-level singleton state so all consumers share the same toggle/audio state.
 * Should only be instantiated once (in ChatPanel.vue) and provided via inject to children.
 */

import { ref, nextTick } from 'vue'
import { useToast } from '@/composables/useToast.ts'

const STORAGE_KEY = 'clawbench-auto-speech'

// --- Singleton state (shared across all instances) ---
const enabled = ref(false)
const isGenerating = ref(false)
const currentAudio = ref<HTMLAudioElement | null>(null)
const activeId = ref<string>('')
const playingSummary = ref<string>('')
const currentPhase = ref<string>('')  // 'summarizing' | 'synthesizing' | ''
const lastError = ref<string>('')
let abortController: AbortController | null = null

// Load persisted state once at module level
try {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved !== null) enabled.value = saved === 'true'
} catch {
  // localStorage may be unavailable (e.g. private browsing)
}

// Module-level toast instance (shared, not per-component)
const toast = useToast()

export function useAutoSpeech() {
  // --- Persistence ---
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled.value))
    } catch {
      // Silently ignore
    }
  }

  function toggle() {
    enabled.value = !enabled.value
    saveState()
    // If toggled OFF, stop any playing audio and pending requests
    if (!enabled.value) stopAudio()
  }

  // --- Audio Playback ---
  function stopAudio() {
    // Cancel any in-flight TTS request
    abortController?.abort()
    abortController = null
    // Stop currently playing audio
    if (currentAudio.value) {
      currentAudio.value.pause()
      currentAudio.value.currentTime = 0
      currentAudio.value = null
    }
    activeId.value = ''
    playingSummary.value = ''
    currentPhase.value = ''
  }

  // --- Report an error to the user via toast ---
  function reportError(message: string) {
    lastError.value = message
    toast.show(message, { icon: '🔊', type: 'info', duration: 5000 })
  }

  // --- Internal: generate and play TTS for text ---
  async function _speak(id: string, text: string) {
    if (!text) return

    // Interrupt any currently playing audio and pending request
    stopAudio()
    lastError.value = ''

    // Set up new abort controller for this request
    const controller = new AbortController()
    abortController = controller
    isGenerating.value = true
    activeId.value = id
    currentPhase.value = ''

    try {
      // POST to backend TTS endpoint (SSE streaming)
      const resp = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })

      if (!resp.ok) {
        let errorMsg = `语音生成失败 (HTTP ${resp.status})`
        try {
          const errData = await resp.json()
          if (errData.error) errorMsg = errData.error
        } catch { /* ignore parse error */ }
        throw new Error(errorMsg)
      }

      // Parse SSE stream to get the final result
      const reader = resp.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')

      const decoder = new TextDecoder()
      let resultData = null
      let sseBuffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        sseBuffer += decoder.decode(value, { stream: true })

        // Process complete SSE messages (delimited by \n\n)
        while (sseBuffer.includes('\n\n')) {
          const idx = sseBuffer.indexOf('\n\n')
          const block = sseBuffer.slice(0, idx)
          sseBuffer = sseBuffer.slice(idx + 2)

          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))
              if (event.type === 'phase') {
                // Update phase and yield to Vue for DOM render
                currentPhase.value = event.phase || ''
                await nextTick()
              } else if (event.type === 'result') {
                resultData = event
              }
            } catch { /* ignore malformed SSE lines */ }
          }
        }
      }

      if (!resultData) throw new Error('语音服务未返回结果')

      // Handle synthesize failure
      if (resultData.synthesizeFailed) {
        throw new Error(resultData.synthesizeError || '语音合成失败，请稍后重试')
      }

      if (!resultData.audioPath) throw new Error('语音服务未返回音频文件')

      // Warn if summarization failed (fell back to full text)
      if (resultData.summarizeFailed) {
        toast.show('摘要生成失败，将朗读原文', { icon: '🔊', type: 'info', duration: 3000 })
      }

      // Store the AI-generated summary for display
      if (resultData.summary) {
        playingSummary.value = resultData.summary
      }

      // Play audio via HTML5 Audio element
      const audioUrl = `/api/local-file/${encodeURIComponent(resultData.audioPath)}`
      const audio = new Audio(audioUrl)
      currentAudio.value = audio

      audio.onended = () => {
        currentAudio.value = null
        activeId.value = ''
        playingSummary.value = ''
        currentPhase.value = ''
      }
      audio.onerror = () => {
        currentAudio.value = null
        activeId.value = ''
        playingSummary.value = ''
        currentPhase.value = ''
        reportError('音频播放失败，请重试')
      }

      await audio.play()
    } catch (err: any) {
      // Ignore AbortError (interrupted by a newer request or user stop)
      if (err?.name === 'AbortError') return

      // Determine user-friendly error message
      let message = '语音生成失败，请稍后重试'
      if (err?.name === 'NotAllowedError') {
        message = '浏览器禁止自动播放音频，请手动点击朗读按钮'
      } else if (err?.message) {
        message = err.message
      }
      reportError(message)
      // Reset state on error
      activeId.value = ''
      playingSummary.value = ''
      currentPhase.value = ''
    } finally {
      // Only clear generating state if this is still the active request
      if (abortController === controller) {
        isGenerating.value = false
        abortController = null
      }
    }
  }

  // --- Auto-speech trigger (respects toggle state) ---
  function speakMessage(id: string, text: string) {
    if (!enabled.value) return
    _speak(id, text)
  }

  // --- Manual play trigger (always works, regardless of toggle) ---
  function speakText(id: string, text: string) {
    _speak(id, text)
  }

  // --- Check if a specific message (by id) is currently generating ---
  function isGeneratingText(id: string): boolean {
    return activeId.value === id && isGenerating.value
  }

  // --- Check if a specific message (by id) is currently playing audio ---
  function isPlayingAudio(id: string): boolean {
    return activeId.value === id && !isGenerating.value && currentAudio.value !== null
  }

  // --- Check if a specific message (by id) is in any active state (generating or playing) ---
  function isActive(id: string): boolean {
    return activeId.value === id && (isGenerating.value || currentAudio.value !== null)
  }

  // --- Get the AI-generated summary for the currently playing message ---
  function getSummary(id: string): string {
    return activeId.value === id ? playingSummary.value : ''
  }

  // --- Get current phase label for a message ---
  function getPhaseLabel(id: string): string {
    if (activeId.value !== id || !isGenerating.value) return ''
    if (currentPhase.value === 'summarizing') return '摘要中'
    if (currentPhase.value === 'synthesizing') return '合成中'
    return '生成中'
  }

  return {
    enabled,
    isGenerating,
    currentPhase,
    lastError,
    toggle,
    speakMessage,
    speakText,
    stopAudio,
    isGeneratingText,
    isPlayingAudio,
    isActive,
    getSummary,
    getPhaseLabel,
  }
}
