export const DEFAULT_LEFT_WIDTH = 480
export const DEFAULT_MIN_COLUMN_WIDTH = 240
export const DIVIDER_WIDTH = 16
const KEYBOARD_STEP = 16

export function positiveWidth(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : fallback
}

export function columnBounds(
  containerWidth: number,
  minLeftWidth: number,
  minRightWidth: number,
): { min: number; max: number } | null {
  if (!Number.isFinite(containerWidth)) return null
  const max = Math.floor(containerWidth - DIVIDER_WIDTH - minRightWidth)
  return max < minLeftWidth ? null : { min: minLeftWidth, max }
}

export function clampColumnWidth(
  width: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, Math.round(width)))
}

export function columnWidthForKey(
  key: string,
  width: number,
  min: number,
  max: number,
): number | null {
  const current = clampColumnWidth(width, min, max)
  switch (key) {
    case 'ArrowLeft':
      return clampColumnWidth(current - KEYBOARD_STEP, min, max)
    case 'ArrowRight':
      return clampColumnWidth(current + KEYBOARD_STEP, min, max)
    case 'Home':
      return min
    case 'End':
      return max
    default:
      return null
  }
}
