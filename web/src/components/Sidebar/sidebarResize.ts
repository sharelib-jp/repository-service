export const SIDEBAR_MIN_WIDTH = 192
export const SIDEBAR_MAX_WIDTH = 480
export const SIDEBAR_DEFAULT_WIDTH = 280
const SIDEBAR_STEP = 16
const VISIBLE_CONTENT_WIDTH = 56

// Keep a portion of the page visible on a small viewport.
export function sidebarMaxWidth(viewportWidth: number): number {
  return Math.max(
    1,
    Math.min(
      SIDEBAR_MAX_WIDTH,
      Math.floor(viewportWidth) - VISIBLE_CONTENT_WIDTH,
    ),
  )
}

export function clampSidebarWidth(width: number, maxWidth: number): number {
  const minWidth = Math.min(SIDEBAR_MIN_WIDTH, maxWidth)
  return Math.max(minWidth, Math.min(maxWidth, Math.round(width)))
}

export function sidebarWidthForKey(
  key: string,
  width: number,
  maxWidth: number,
): number | null {
  const current = clampSidebarWidth(width, maxWidth)
  switch (key) {
    case 'ArrowLeft':
      return clampSidebarWidth(current - SIDEBAR_STEP, maxWidth)
    case 'ArrowRight':
      return clampSidebarWidth(current + SIDEBAR_STEP, maxWidth)
    case 'Home':
      return Math.min(SIDEBAR_MIN_WIDTH, maxWidth)
    case 'End':
      return maxWidth
    default:
      return null
  }
}
