import { describe, expect, it } from 'vitest'
import { computeMenuStyle } from '../popupMenuPosition'

// Helper to create a mock DOMRect
function mockRect(options: {
  top?: number
  bottom?: number
  left?: number
  right?: number
  width?: number
  height?: number
}): DOMRect {
  return {
    top: options.top ?? 0,
    bottom: options.bottom ?? 0,
    left: options.left ?? 0,
    right: options.right ?? 0,
    width: options.width ?? 0,
    height: options.height ?? 0,
    x: options.left ?? 0,
    y: options.top ?? 0,
    toJSON: () => ({}),
  }
}

describe('computeMenuStyle', () => {
  describe('left anchor — above-anchor mode', () => {
    it('positions menu above the anchor element when enough space', () => {
      const rect = mockRect({ top: 400, bottom: 440, left: 100, right: 140 })
      const style = computeMenuStyle(rect, { viewportWidth: 1024, viewportHeight: 768 })

      expect(style.position).toBe('fixed')
      expect(style.left).toBe('100px')
      // bottom = 768 - 400 + 4 = 372
      expect(style.bottom).toBe('372px')
      expect(style.top).toBeUndefined()
    })

    it('clamps left position to edgeMargin when anchor is near left edge', () => {
      const rect = mockRect({ top: 400, bottom: 440, left: 2, right: 30 })
      const style = computeMenuStyle(rect, { viewportWidth: 1024, viewportHeight: 768, edgeMargin: 8 })

      expect(style.left).toBe('8px')
    })

    it('shifts left when menu would overflow right viewport edge', () => {
      const rect = mockRect({ top: 400, bottom: 440, left: 900, right: 930 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        maxWidth: 200,
        edgeMargin: 6,
      })

      expect(style.left).toBe('818px')
    })

    it('keeps menu above anchor when there is enough space', () => {
      // rect.top=400, estMenuHeight=36+5*28=176, spaceAbove=400-6=394 >= 176 → above
      const rect = mockRect({ top: 400, bottom: 440, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount: 5,
        edgeMargin: 6,
      })

      expect(style.bottom).toBe('372px')
      expect(style.top).toBeUndefined()
    })

    it('places menu bottom edge 4px above anchor top edge', () => {
      const rect = mockRect({ top: 500, bottom: 540, left: 100, right: 140 })
      const style = computeMenuStyle(rect, { viewportWidth: 1024, viewportHeight: 768, menuItemsCount: 2 })

      // bottom = 768 - 500 + 4 = 272 → menu bottom at viewport Y = 768 - 272 = 496, which is 4px above rect.top=500
      expect(style.bottom).toBe('272px')
    })
  })

  describe('left anchor — flip-below mode', () => {
    it('flips menu below the anchor when not enough space above', () => {
      // rect.top=5, estMenuHeight=36+5*28=176, spaceAbove=5-10=-5 < 176 → flip-below
      const rect = mockRect({ top: 5, bottom: 40, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount: 5,
        edgeMargin: 10,
      })

      // Flip-below: top = rect.bottom + 4 = 44
      expect(style.top).toBe('44px')
      expect(style.bottom).toBeUndefined()
    })

    it('flips menu below anchor at top=0', () => {
      // spaceAbove = 0 - 6 = -6 < 176 → flip-below
      const rect = mockRect({ top: 0, bottom: 40, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        edgeMargin: 6,
        menuItemsCount: 5,
      })

      expect(style.top).toBe('44px')
      expect(style.bottom).toBeUndefined()
    })

    it('places menu top edge 4px below anchor bottom edge', () => {
      const rect = mockRect({ top: 10, bottom: 50, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount: 5,
        edgeMargin: 6,
      })

      // top = 50 + 4 = 54 → menu top starts exactly 4px below anchor bottom
      expect(style.top).toBe('54px')
    })

    it('uses top positioning to avoid gap caused by estimated vs actual height mismatch', () => {
      // This is the core bug fix: the old bottom-based positioning would create
      // a gap between the anchor and the menu when estMenuHeight > actual height.
      // With top-based positioning, the menu top is always rect.bottom + 4.
      const rect = mockRect({ top: 4, bottom: 36, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 800,
        menuItemsCount: 4,
        edgeMargin: 6,
      })

      // top = 36 + 4 = 40, always right below the anchor regardless of estMenuHeight
      expect(style.top).toBe('40px')
      expect(style.bottom).toBeUndefined()
    })
  })

  describe('right anchor — above-anchor mode', () => {
    it('positions menu above and right-aligned to anchor', () => {
      const rect = mockRect({ top: 400, bottom: 440, left: 800, right: 900 })
      const style = computeMenuStyle(rect, {
        anchor: 'right',
        viewportWidth: 1024,
        viewportHeight: 768,
      })

      expect(style.position).toBe('fixed')
      expect(style.right).toBe('124px')
      expect(style.bottom).toBe('372px')
      expect(style.left).toBeUndefined()
    })

    it('clamps right position to edgeMargin when anchor is near right edge', () => {
      const rect = mockRect({ top: 400, bottom: 440, left: 900, right: 1020 })
      const style = computeMenuStyle(rect, {
        anchor: 'right',
        viewportWidth: 1024,
        viewportHeight: 768,
        edgeMargin: 8,
      })

      expect(style.right).toBe('8px')
    })

    it('shifts right when menu would overflow left viewport edge', () => {
      const rect = mockRect({ top: 400, bottom: 440, left: 0, right: 50 })
      const style = computeMenuStyle(rect, {
        anchor: 'right',
        viewportWidth: 1024,
        viewportHeight: 768,
        maxWidth: 200,
        edgeMargin: 6,
      })

      expect(style.right).toBe('818px')
    })
  })

  describe('right anchor — flip-below mode', () => {
    it('flips menu below anchor in right-aligned mode when no space above', () => {
      const rect = mockRect({ top: 5, bottom: 40, left: 800, right: 900 })
      const style = computeMenuStyle(rect, {
        anchor: 'right',
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount: 5,
        edgeMargin: 10,
      })

      expect(style.top).toBe('44px')
      expect(style.bottom).toBeUndefined()
      expect(style.right).toBeDefined()
    })

    it('preserves right alignment in flip-below mode', () => {
      const rect = mockRect({ top: 5, bottom: 36, left: 800, right: 900 })
      const style = computeMenuStyle(rect, {
        anchor: 'right',
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount: 5,
        edgeMargin: 6,
      })

      // right = 1024 - 900 = 124
      expect(style.right).toBe('124px')
      expect(style.left).toBeUndefined()
    })
  })

  describe('flip boundary conditions', () => {
    it('stays above when spaceAbove exactly equals estMenuHeight', () => {
      // spaceAbove = rect.top - edgeMargin; flip when spaceAbove < estMenuHeight
      // estMenuHeight = 36 + 5*28 = 176; need spaceAbove = 176 exactly → no flip (< not <=)
      const edgeMargin = 6
      const menuItemsCount = 5
      const estMenuHeight = 36 + menuItemsCount * 28 // 176
      const rect = mockRect({ top: estMenuHeight + edgeMargin, bottom: estMenuHeight + edgeMargin + 40, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount,
        edgeMargin,
      })

      // spaceAbove = 182 exactly = estMenuHeight → NOT < estMenuHeight → stay above
      expect(style.bottom).toBeDefined()
      expect(style.top).toBeUndefined()
    })

    it('flips below when spaceAbove is one less than estMenuHeight', () => {
      const edgeMargin = 6
      const menuItemsCount = 5
      const estMenuHeight = 36 + menuItemsCount * 28 // 176
      const rect = mockRect({ top: estMenuHeight + edgeMargin - 1, bottom: estMenuHeight + edgeMargin + 39, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount,
        edgeMargin,
      })

      // spaceAbove = 181 - 6 = 175 < 176 → flip
      expect(style.top).toBeDefined()
      expect(style.bottom).toBeUndefined()
    })

    it('flips with small menuItemsCount when anchor is at very top', () => {
      // Even 1 item (estMenuHeight=64) won't fit above if rect.top is tiny
      const rect = mockRect({ top: 5, bottom: 40, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount: 1,
        edgeMargin: 10,
      })

      // spaceAbove = 5 - 10 = -5 < 64 → flip
      expect(style.top).toBe('44px')
    })

    it('does not flip with small menuItemsCount when anchor is far from top', () => {
      const rect = mockRect({ top: 200, bottom: 240, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount: 1,
        edgeMargin: 6,
      })

      // spaceAbove = 200 - 6 = 194 >= 64 → stay above
      expect(style.bottom).toBeDefined()
      expect(style.top).toBeUndefined()
    })

    it('flips with large menuItemsCount even when anchor is mid-viewport', () => {
      const rect = mockRect({ top: 300, bottom: 340, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount: 20, // estMenuHeight = 36 + 20*28 = 596
        edgeMargin: 6,
      })

      // spaceAbove = 300 - 6 = 294 < 596 → flip
      expect(style.top).toBe('344px')
      expect(style.bottom).toBeUndefined()
    })
  })

  describe('maxHeight calculation', () => {
    it('uses min of maxHeight and viewport-adjusted value in above-anchor mode', () => {
      // rect.top=500 gives spaceAbove=500-10=490 >= estMenuHeight=316 → above-anchor mode
      const rect = mockRect({ top: 500, bottom: 540, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        maxHeight: 400,
        edgeMargin: 10,
      })

      expect(style.maxHeight).toBe('min(400px, calc(100vh - 20px))')
    })

    it('uses default maxHeight when not specified', () => {
      // rect.top=500 gives spaceAbove=500-6=494 >= estMenuHeight=316 → above-anchor mode
      const rect = mockRect({ top: 500, bottom: 540, left: 100, right: 140 })
      const style = computeMenuStyle(rect, { viewportWidth: 1024, viewportHeight: 768 })

      expect(style.maxHeight).toBe('min(320px, calc(100vh - 12px))')
    })

    it('clamps maxHeight to remaining space below anchor in flip-below mode', () => {
      const rect = mockRect({ top: 5, bottom: 40, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        maxHeight: 400,
        menuItemsCount: 5,
        edgeMargin: 10,
      })

      // top = 44, maxHeight = min(400px, calc(100vh - 54px))
      expect(style.maxHeight).toBe('min(400px, calc(100vh - 54px))')
    })

    it('clamps maxHeight with default values in flip-below mode', () => {
      const rect = mockRect({ top: 5, bottom: 40, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount: 5,
        edgeMargin: 6,
      })

      // top = 40 + 4 = 44, maxHeight = min(320px, calc(100vh - 50px))
      expect(style.maxHeight).toBe('min(320px, calc(100vh - 50px))')
    })

    it('shrinks maxHeight when anchor is further down the viewport', () => {
      // Anchor at Y=200 → less room below
      const rect = mockRect({ top: 5, bottom: 200, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        maxHeight: 600,
        menuItemsCount: 5,
        edgeMargin: 10,
      })

      // top = 200 + 4 = 204, maxHeight = min(600px, calc(100vh - 214px))
      expect(style.maxHeight).toBe('min(600px, calc(100vh - 214px))')
    })
  })

  describe('real-world scenarios', () => {
    it('AppHeader settings gear icon (anchor near top, right-aligned)', () => {
      // Simulates the actual AppHeader gear button: fixed header at top:0, height:40px,
      // gear button is ~32px tall with 6px padding, centered in the 40px header
      const rect = mockRect({ top: 4, bottom: 36, left: 900, right: 930 })
      const style = computeMenuStyle(rect, {
        anchor: 'right',
        viewportWidth: 1024,
        viewportHeight: 768,
        maxWidth: 200,
        maxHeight: 280,
        menuItemsCount: 4, // zh + en + dark + light
        edgeMargin: 6,
      })

      // Must flip below, menu top = 36 + 4 = 40, right next to the gear button
      expect(style.top).toBe('40px')
      expect(style.bottom).toBeUndefined()
      expect(style.right).toBeDefined()
      // maxHeight accounts for available space below
      expect(style.maxHeight).toBe('min(280px, calc(100vh - 46px))')
    })

    it('AppHeader settings gear icon on narrow mobile screen', () => {
      const rect = mockRect({ top: 4, bottom: 36, left: 330, right: 360 })
      const style = computeMenuStyle(rect, {
        anchor: 'right',
        viewportWidth: 375,
        viewportHeight: 667,
        maxWidth: 200,
        maxHeight: 280,
        menuItemsCount: 4,
        edgeMargin: 6,
      })

      expect(style.top).toBe('40px')
      // right = 375 - 360 = 15
      expect(style.right).toBe('15px')
    })

    it('ChatInputBar attach button (anchor near bottom, left-aligned)', () => {
      // Simulates the attach button in the chat input bar near the bottom of the screen
      const rect = mockRect({ top: 700, bottom: 730, left: 10, right: 40 })
      const style = computeMenuStyle(rect, {
        anchor: 'left',
        viewportWidth: 375,
        viewportHeight: 667,
        maxWidth: 200,
        maxHeight: 280,
        menuItemsCount: 3,
        edgeMargin: 6,
      })

      // spaceAbove = 700 - 6 = 694 >= estMenuHeight=120 → above-anchor mode
      expect(style.bottom).toBeDefined()
      expect(style.top).toBeUndefined()
      expect(style.left).toBe('10px')
    })

    it('ChatInputBar quick-send (anchor near bottom, right-aligned)', () => {
      const rect = mockRect({ top: 700, bottom: 730, left: 320, right: 360 })
      const style = computeMenuStyle(rect, {
        anchor: 'right',
        viewportWidth: 375,
        viewportHeight: 667,
        maxWidth: 260,
        maxHeight: 280,
        menuItemsCount: 5,
        edgeMargin: 6,
      })

      // spaceAbove = 700 - 6 = 694 >= 176 → above-anchor mode
      expect(style.bottom).toBeDefined()
      expect(style.top).toBeUndefined()
      expect(style.right).toBeDefined()
    })

    it('TerminalPanel quick commands (anchor near bottom, right-aligned)', () => {
      const rect = mockRect({ top: 680, bottom: 710, left: 320, right: 360 })
      const style = computeMenuStyle(rect, {
        anchor: 'right',
        viewportWidth: 375,
        viewportHeight: 667,
        maxWidth: 220,
        maxHeight: 280,
        menuItemsCount: 3,
        edgeMargin: 6,
      })

      // spaceAbove = 680 - 6 = 674 >= 120 → above-anchor mode
      expect(style.bottom).toBeDefined()
      expect(style.top).toBeUndefined()
    })
  })

  describe('style completeness', () => {
    it('always includes position, maxWidth, maxHeight, and overflowY', () => {
      const rects = [
        mockRect({ top: 5, bottom: 40, left: 100, right: 140 }),
        mockRect({ top: 400, bottom: 440, left: 100, right: 140 }),
        mockRect({ top: 5, bottom: 40, left: 800, right: 900 }),
        mockRect({ top: 400, bottom: 440, left: 800, right: 900 }),
      ]

      for (const rect of rects) {
        for (const anchor of ['left', 'right'] as const) {
          const style = computeMenuStyle(rect, { anchor, viewportWidth: 1024, viewportHeight: 768 })
          expect(style.position).toBe('fixed')
          expect(style.maxWidth).toBeDefined()
          expect(style.maxHeight).toBeDefined()
          expect(style.overflowY).toBe('auto')
        }
      }
    })

    it('never sets both top and bottom simultaneously', () => {
      const testCases = [
        { rect: mockRect({ top: 5, bottom: 40, left: 100, right: 140 }), anchor: 'left' as const },
        { rect: mockRect({ top: 400, bottom: 440, left: 100, right: 140 }), anchor: 'left' as const },
        { rect: mockRect({ top: 5, bottom: 40, left: 800, right: 900 }), anchor: 'right' as const },
        { rect: mockRect({ top: 400, bottom: 440, left: 800, right: 900 }), anchor: 'right' as const },
      ]

      for (const { rect, anchor } of testCases) {
        const style = computeMenuStyle(rect, { anchor, viewportWidth: 1024, viewportHeight: 768 })
        const hasTop = style.top !== undefined
        const hasBottom = style.bottom !== undefined
        expect(hasTop && hasBottom).toBe(false)
      }
    })

    it('never sets both left and right simultaneously', () => {
      const testCases = [
        { rect: mockRect({ top: 400, bottom: 440, left: 100, right: 140 }), anchor: 'left' as const },
        { rect: mockRect({ top: 400, bottom: 440, left: 800, right: 900 }), anchor: 'right' as const },
      ]

      for (const { rect, anchor } of testCases) {
        const style = computeMenuStyle(rect, { anchor, viewportWidth: 1024, viewportHeight: 768 })
        const hasLeft = style.left !== undefined
        const hasRight = style.right !== undefined
        expect(hasLeft && hasRight).toBe(false)
      }
    })
  })

  describe('edge cases', () => {
    it('handles anchor at exact viewport center', () => {
      const rect = mockRect({ top: 384, bottom: 404, left: 512, right: 532 })
      const style = computeMenuStyle(rect, { viewportWidth: 1024, viewportHeight: 768 })

      expect(style.position).toBe('fixed')
      expect(style.left).toBe('512px')
    })

    it('handles zero-height anchor element', () => {
      const rect = mockRect({ top: 300, bottom: 300, left: 100, right: 140 })
      const style = computeMenuStyle(rect, { viewportWidth: 1024, viewportHeight: 768 })

      // spaceAbove = 300 - 6 = 294 < estMenuHeight=316 → flip-below
      // top = 300 + 4 = 304
      expect(style.top).toBe('304px')
    })

    it('handles minimal viewport', () => {
      const rect = mockRect({ top: 5, bottom: 15, left: 5, right: 15 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 50,
        viewportHeight: 50,
        maxWidth: 40,
        edgeMargin: 2,
        menuItemsCount: 2,
      })

      expect(style.position).toBe('fixed')
      // spaceAbove = 5 - 2 = 3 < 92 → flip-below
      // top = 15 + 4 = 19
      expect(style.top).toBe('19px')
      // Left anchor mode (default) → uses left
      expect(Number.parseInt(style.left)).not.toBeNaN()
    })

    it('handles very large menuItemsCount with flip-below', () => {
      const rect = mockRect({ top: 5, bottom: 50, left: 100, right: 140 })
      const vh = 768
      const menuItemsCount = 100
      const edgeMargin = 10

      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: vh,
        menuItemsCount,
        edgeMargin,
      })

      // Flip-below: top = 50 + 4 = 54
      expect(style.top).toBe('54px')
      // maxHeight is clamped to remaining space: calc(100vh - 64px)
      expect(style.maxHeight).toBe('min(320px, calc(100vh - 64px))')
    })

    it('handles negative rect.top (anchor partially above viewport)', () => {
      const rect = mockRect({ top: -10, bottom: 30, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount: 5,
        edgeMargin: 6,
      })

      // spaceAbove = -10 - 6 = -16 < 176 → flip-below
      // top = 30 + 4 = 34
      expect(style.top).toBe('34px')
    })

    it('handles anchor at very bottom of viewport', () => {
      const rect = mockRect({ top: 700, bottom: 740, left: 100, right: 140 })
      const style = computeMenuStyle(rect, {
        viewportWidth: 1024,
        viewportHeight: 768,
        menuItemsCount: 5,
        edgeMargin: 6,
      })

      // spaceAbove = 700 - 6 = 694 >= 176 → above-anchor mode
      expect(style.bottom).toBeDefined()
      expect(style.top).toBeUndefined()
    })

    it('produces consistent left/right values for same anchor position', () => {
      const rect = mockRect({ top: 400, bottom: 440, left: 500, right: 540 })
      const leftStyle = computeMenuStyle(rect, {
        anchor: 'left',
        viewportWidth: 1024,
        viewportHeight: 768,
      })
      const rightStyle = computeMenuStyle(rect, {
        anchor: 'right',
        viewportWidth: 1024,
        viewportHeight: 768,
      })

      expect(leftStyle.position).toBe('fixed')
      expect(rightStyle.position).toBe('fixed')
      expect(leftStyle.left).toBeDefined()
      expect(rightStyle.right).toBeDefined()
    })

    it('does not use top when anchor is far from viewport top', () => {
      const rect = mockRect({ top: 400, bottom: 440, left: 100, right: 140 })
      const style = computeMenuStyle(rect, { viewportWidth: 1024, viewportHeight: 768 })

      expect(style.bottom).toBeDefined()
      expect(style.top).toBeUndefined()
    })
  })
})
