/**
 * PopupMenu positioning utilities — pure functions for computing
 * the fixed-position style of a popup menu relative to an anchor element.
 *
 * Extracted from PopupMenu.vue for testability.
 *
 * Positioning strategy:
 * - **Above anchor** (default): When the anchor is far enough from the viewport
 *   top, the menu appears above the anchor using `bottom` positioning. The menu
 *   grows upward from just above the anchor.
 * - **Below anchor** (flip): When the anchor is near the viewport top and there
 *   isn't enough space above for the menu, it flips below the anchor using
 *   `top` positioning. This ensures the menu's top edge is always 4px below
 *   the anchor's bottom edge, regardless of estimated vs actual menu height.
 */

/**
 * Compute the CSS style object for a popup menu's fixed position.
 *
 * @param rect - The getBoundingClientRect() of the anchor element
 * @param opts - Positioning options
 * @returns A CSS style object suitable for binding to the menu element
 */
export function computeMenuStyle(
  rect: DOMRect,
  opts: {
    anchor?: 'left' | 'right'
    maxWidth?: number
    maxHeight?: number
    edgeMargin?: number
    menuItemsCount?: number
    viewportWidth?: number
    viewportHeight?: number
  } = {}
): Record<string, string> {
  const {
    anchor = 'left',
    maxWidth = 220,
    maxHeight = 320,
    edgeMargin = 6,
    menuItemsCount = 10,
    viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024,
    viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768,
  } = opts

  const estMenuHeight = 36 + menuItemsCount * 28
  const gap = 4

  // Horizontal positioning
  const horizontal = computeHorizontal(rect, anchor, maxWidth, edgeMargin, viewportWidth)

  // Decide vertical placement: above (default) or below (flip when near top)
  const spaceAbove = rect.top - edgeMargin
  const flipBelow = spaceAbove < estMenuHeight

  if (flipBelow) {
    // Menu appears BELOW the anchor using `top` positioning.
    // This guarantees the menu top edge is always `gap`px below the anchor
    // bottom edge, regardless of estimated vs actual menu height.
    const top = rect.bottom + gap

    return {
      position: 'fixed',
      top: `${top}px`,
      ...horizontal,
      maxWidth: `${maxWidth}px`,
      maxHeight: `min(${maxHeight}px, calc(100vh - ${top + edgeMargin}px))`,
      overflowY: 'auto',
    }
  }

  // Menu appears ABOVE the anchor using `bottom` positioning.
  // The menu grows upward from just above the anchor.
  const bottom = viewportHeight - rect.top + gap

  return {
    position: 'fixed',
    bottom: `${bottom}px`,
    ...horizontal,
    maxWidth: `${maxWidth}px`,
    maxHeight: `min(${maxHeight}px, calc(100vh - ${edgeMargin * 2}px))`,
    overflowY: 'auto',
  }
}

/**
 * Compute horizontal positioning (left or right) for the menu.
 */
function computeHorizontal(
  rect: DOMRect,
  anchor: 'left' | 'right',
  maxWidth: number,
  edgeMargin: number,
  viewportWidth: number,
): Record<string, string> {
  if (anchor === 'right') {
    let right = viewportWidth - rect.right
    if (right + maxWidth + edgeMargin > viewportWidth) {
      right = viewportWidth - maxWidth - edgeMargin
    }
    right = Math.max(edgeMargin, right)
    return { right: `${right}px` }
  }

  // Left-aligned (default)
  let left = rect.left
  if (left + maxWidth + edgeMargin > viewportWidth) {
    left = viewportWidth - maxWidth - edgeMargin
  }
  left = Math.max(edgeMargin, left)
  return { left: `${left}px` }
}
