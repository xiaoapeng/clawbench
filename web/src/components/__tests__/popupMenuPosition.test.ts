import { describe, it, expect } from 'vitest'
import { computeMenuStyle } from '@/utils/popupMenuPosition'

/** Helper: create a DOMRect-like object. */
function rect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x, y, width: w, height: h,
    top: y, right: x + w, bottom: y + h, left: x,
    toJSON() { return this },
  }
}

describe('computeMenuStyle — mobile auto-alignment', () => {
  const vw = 390  // iPhone 14 width
  const vh = 844  // iPhone 14 height

  it('deep-thinking chip (rightmost) auto right-aligns and goes above', () => {
    const r = rect(310, 780, 74, 28) // rightmost button
    const style = computeMenuStyle(r, { viewportWidth: vw, viewportHeight: vh, maxWidth: 200, menuItemsCount: 4, edgeMargin: 6 })
    // Center = 347 > 195 → right-align
    expect(style.right).toBeDefined()
    expect(style.left).toBeUndefined()
    // spaceAbove=770 > spaceBelow=30 → above
    expect(style.bottom).toBeDefined()
    expect(style.top).toBeUndefined()
  })

  it('model chip (second from right) auto right-aligns and goes above', () => {
    const r = rect(200, 780, 100, 28) // GLM button
    const style = computeMenuStyle(r, { viewportWidth: vw, viewportHeight: vh, maxWidth: 220, menuItemsCount: 3, edgeMargin: 6 })
    // Center = 250 > 195 → right-align
    expect(style.right).toBeDefined()
    // spaceAbove=770 > spaceBelow=30 → above
    expect(style.bottom).toBeDefined()
  })

  it('settings gear (top-right) auto right-aligns and goes below', () => {
    const r = rect(330, 4, 30, 32)
    const style = computeMenuStyle(r, { viewportWidth: vw, viewportHeight: vh, maxWidth: 200, menuItemsCount: 4, edgeMargin: 6 })
    // Center = 345 > 195 → right-align
    expect(style.right).toBeDefined()
    // spaceAbove=-2 < spaceBelow=802 → below
    expect(style.top).toBeDefined()
    expect(style.bottom).toBeUndefined()
  })

  it('attach button (bottom-left) auto left-aligns and goes above', () => {
    const r = rect(10, 780, 30, 28)
    const style = computeMenuStyle(r, { viewportWidth: vw, viewportHeight: vh, maxWidth: 200, menuItemsCount: 3, edgeMargin: 6 })
    // Center = 25 < 195 → left-align
    expect(style.left).toBeDefined()
    expect(style.right).toBeUndefined()
    // spaceAbove=770 > spaceBelow=30 → above
    expect(style.bottom).toBeDefined()
  })
})
