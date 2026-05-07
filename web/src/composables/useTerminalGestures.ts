import { ref, type Ref } from 'vue'

export interface GestureCallbacks {
  sendArrowUp: () => void
  sendArrowDown: () => void
  sendArrowLeft: () => void
  sendArrowRight: () => void
  sendTab: () => void
  onPinchZoom?: (delta: number) => void
}

type Direction = 'up' | 'down' | 'left' | 'right'

/**
 * Termius-style touch gestures for the terminal area.
 * - Swipe left/right → arrow left/right
 * - Swipe up/down → arrow up/down
 * - Hold direction → auto-repeat arrow keys
 * - Double-tap → Tab
 * - Pinch (two-finger) → zoom font size
 *
 * Gestures are bound only to the xterm container element,
 * not the entire BottomSheet, to avoid conflicting with drawer drag.
 */
export function useTerminalGestures(
  elementRef: Ref<HTMLElement | null>,
  callbacks: GestureCallbacks
) {
  const SWIPE_THRESHOLD = 30 // minimum px for a swipe
  const DOUBLE_TAP_DELAY = 300 // max ms between taps for double-tap
  const PINCH_THRESHOLD = 10 // minimum px change before triggering zoom
  const REPEAT_INITIAL_DELAY = 500 // ms before auto-repeat starts
  const REPEAT_INTERVAL = 150 // ms between repeated arrow keys

  // Gesture enable/disable state
  const enabled = ref(true)

  let touchStartX = 0
  let touchStartY = 0
  let lastTapTime = 0
  let isActive = false

  // Direction tracking for hold-to-repeat
  let currentDirection: Direction | null = null
  let repeatTimer: ReturnType<typeof setTimeout> | null = null
  let repeatInterval: ReturnType<typeof setInterval> | null = null

  // Pinch zoom state
  let initialPinchDistance = 0
  let lastPinchDistance = 0
  let accumulatedPinchDelta = 0

  function getTouchDistance(t1: Touch, t2: Touch): number {
    const dx = t1.clientX - t2.clientX
    const dy = t1.clientY - t2.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  function sendArrow(dir: Direction) {
    switch (dir) {
      case 'up': callbacks.sendArrowUp(); break
      case 'down': callbacks.sendArrowDown(); break
      case 'left': callbacks.sendArrowLeft(); break
      case 'right': callbacks.sendArrowRight(); break
    }
  }

  function startRepeat(dir: Direction) {
    stopRepeat()
    repeatTimer = setTimeout(() => {
      repeatInterval = setInterval(() => {
        sendArrow(dir)
      }, REPEAT_INTERVAL)
    }, REPEAT_INITIAL_DELAY)
  }

  function stopRepeat() {
    if (repeatTimer) {
      clearTimeout(repeatTimer)
      repeatTimer = null
    }
    if (repeatInterval) {
      clearInterval(repeatInterval)
      repeatInterval = null
    }
  }

  function detectDirection(dx: number, dy: number): Direction | null {
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)
    if (absDx < SWIPE_THRESHOLD && absDy < SWIPE_THRESHOLD) return null
    if (absDx > absDy) {
      return dx > 0 ? 'right' : 'left'
    } else {
      return dy > 0 ? 'down' : 'up'
    }
  }

  function onTouchStart(e: TouchEvent) {
    if (!enabled.value) return

    if (e.touches.length === 2) {
      // Pinch gesture start
      initialPinchDistance = getTouchDistance(e.touches[0], e.touches[1])
      lastPinchDistance = initialPinchDistance
      accumulatedPinchDelta = 0
      isActive = false // cancel any single-finger gesture
      stopRepeat()
      currentDirection = null
      return
    }

    if (e.touches.length !== 1) return

    const touch = e.touches[0]
    touchStartX = touch.clientX
    touchStartY = touch.clientY
    isActive = true
    currentDirection = null
  }

  function onTouchMove(e: TouchEvent) {
    if (!enabled.value) return

    // Pinch zoom
    if (e.touches.length === 2 && initialPinchDistance > 0) {
      const currentDistance = getTouchDistance(e.touches[0], e.touches[1])
      const delta = currentDistance - lastPinchDistance
      accumulatedPinchDelta += delta
      lastPinchDistance = currentDistance

      if (Math.abs(accumulatedPinchDelta) >= PINCH_THRESHOLD) {
        const steps = Math.trunc(accumulatedPinchDelta / PINCH_THRESHOLD)
        callbacks.onPinchZoom?.(steps)
        accumulatedPinchDelta -= steps * PINCH_THRESHOLD
      }
      return
    }

    if (!isActive || e.touches.length !== 1) return

    // Direction detection for hold-to-repeat
    const touch = e.touches[0]
    const dx = touch.clientX - touchStartX
    const dy = touch.clientY - touchStartY
    const dir = detectDirection(dx, dy)

    if (dir && dir !== currentDirection) {
      // Direction changed or first detection — send once and start repeat
      currentDirection = dir
      sendArrow(dir)
      startRepeat(dir)
    }
  }

  function onTouchEnd(e: TouchEvent) {
    // Reset pinch state when one or both fingers lift
    if (e.touches.length < 2) {
      initialPinchDistance = 0
      lastPinchDistance = 0
    }

    // Stop any hold-to-repeat
    stopRepeat()

    if (!isActive) return

    const wasDirection = currentDirection
    currentDirection = null
    isActive = false

    // If direction was already handled in touchmove (hold-to-repeat),
    // skip the legacy swipe-on-touchend logic
    if (wasDirection) return

    const touch = e.changedTouches[0]
    const dx = touch.clientX - touchStartX
    const dy = touch.clientY - touchStartY
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)

    // Check for double-tap (small movement)
    if (absDx < 10 && absDy < 10) {
      const now = Date.now()
      if (now - lastTapTime < DOUBLE_TAP_DELAY) {
        callbacks.sendTab()
        lastTapTime = 0 // reset to prevent triple-tap
        return
      }
      lastTapTime = now
      return
    }

    // Quick swipe that didn't trigger in touchmove (fast flick)
    const dir = detectDirection(dx, dy)
    if (dir) {
      sendArrow(dir)
    }
  }

  function toggle() {
    enabled.value = !enabled.value
    if (!enabled.value) {
      stopRepeat()
      isActive = false
      currentDirection = null
    }
  }

  function attach() {
    const el = elementRef.value
    if (!el) return

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
  }

  function detach() {
    const el = elementRef.value
    if (!el) return

    stopRepeat()
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
  }

  return {
    attach,
    detach,
    enabled,
    toggle,
  }
}
