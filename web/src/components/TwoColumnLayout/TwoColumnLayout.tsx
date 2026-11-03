import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import {
  clampColumnWidth,
  columnBounds,
  columnWidthForKey,
  DEFAULT_LEFT_WIDTH,
  DEFAULT_MIN_COLUMN_WIDTH,
  DIVIDER_WIDTH,
  positiveWidth,
} from './columnResize'

export type TwoColumnLayoutProps = {
  left: ReactNode
  right: ReactNode
  /** Initial left-column width in pixels. */
  initialLeftWidth?: number
  /** Minimum column widths in pixels. Stacks vertically when both cannot fit. */
  minLeftWidth?: number
  minRightWidth?: number
  /** Accessible name for the resize handle. */
  resizeLabel?: string
  className?: string
}

type ResizeDrag = {
  pointerId: number
  startX: number
  startWidth: number
}

export function TwoColumnLayout({
  left,
  right,
  initialLeftWidth = DEFAULT_LEFT_WIDTH,
  minLeftWidth = DEFAULT_MIN_COLUMN_WIDTH,
  minRightWidth = DEFAULT_MIN_COLUMN_WIDTH,
  resizeLabel = '左右の表示幅を調整',
  className = '',
}: TwoColumnLayoutProps) {
  const leftId = useId()
  const container = useRef<HTMLDivElement>(null)
  const drag = useRef<ResizeDrag | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [preferredWidth, setPreferredWidth] = useState(() =>
    positiveWidth(initialLeftWidth, DEFAULT_LEFT_WIDTH),
  )
  const bounds = columnBounds(
    containerWidth,
    positiveWidth(minLeftWidth, DEFAULT_MIN_COLUMN_WIDTH),
    positiveWidth(minRightWidth, DEFAULT_MIN_COLUMN_WIDTH),
  )
  const displayedWidth = bounds
    ? clampColumnWidth(preferredWidth, bounds.min, bounds.max)
    : 0

  useEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () =>
      setContainerWidth(element.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) setContainerWidth(entries[0].contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (!bounds || !event.isPrimary || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: displayedWidth,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current
    if (!bounds || !active || active.pointerId !== event.pointerId) return
    setPreferredWidth(
      clampColumnWidth(
        active.startWidth + event.clientX - active.startX,
        bounds.min,
        bounds.max,
      ),
    )
  }

  function endResize(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!bounds) return
    const next = columnWidthForKey(
      event.key,
      displayedWidth,
      bounds.min,
      bounds.max,
    )
    if (next === null) return
    event.preventDefault()
    setPreferredWidth(next)
  }

  return (
    <div
      ref={container}
      className={`grid h-full min-h-0 w-full min-w-0 gap-y-4 ${className}`}
      style={{
        gridTemplateColumns: bounds
          ? `${displayedWidth}px ${DIVIDER_WIDTH}px minmax(0, 1fr)`
          : 'minmax(0, 1fr)',
        gridTemplateRows: bounds ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
      }}
    >
      <div id={leftId} tabIndex={0} className="min-h-0 min-w-0 overflow-auto">
        {left}
      </div>
      {bounds && (
        <div
          role="separator"
          tabIndex={0}
          aria-label={resizeLabel}
          aria-orientation="vertical"
          aria-controls={leftId}
          aria-valuemin={bounds.min}
          aria-valuemax={bounds.max}
          aria-valuenow={displayedWidth}
          aria-valuetext={`${displayedWidth}ピクセル`}
          title="ドラッグまたは左右キーで幅を調整"
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onLostPointerCapture={() => {
            drag.current = null
          }}
          onKeyDown={resizeWithKeyboard}
          className="flex min-h-11 touch-none cursor-col-resize items-center justify-center focus-visible:outline focus-visible:outline-4 focus-visible:outline-black focus-visible:ring-4 focus-visible:ring-yellow-300"
        >
          <span
            aria-hidden="true"
            className="h-12 w-1 rounded-full bg-solid-gray-420"
          />
        </div>
      )}
      <div tabIndex={0} className="min-h-0 min-w-0 overflow-auto">{right}</div>
    </div>
  )
}
