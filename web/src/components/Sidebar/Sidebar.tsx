import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { createLink, useRouterState } from '@tanstack/react-router'
import { MenuList, MenuListItem, MenuListItemLink } from '../../atoms/MenuList'
import {
  clampSidebarWidth,
  sidebarMaxWidth,
  sidebarWidthForKey,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './sidebarResize'
import { Heading, HeadingTitle } from '../../atoms/Heading'

const SidebarLink = createLink(MenuListItemLink)
const navigation = [
  { label: '業務メニュー', to: '/' },
  { label: '登録済み蔵書一覧', to: '/books' },
  { label: '単件蔵書情報登録', to: '/books/register' },
  { label: '単件蔵書情報更新', to: '/books/edit' },
  { label: '単件蔵書変更履歴', to: '/books/history' },
  { label: '登録著者典拠一覧', to: '/authors' },
  { label: '登録出版社典拠一覧', to: '/publishers' },
  { label: 'ユーザー・ロール設定', to: '/settings/users' },
] as const

type SidebarProps = {
  children: ReactNode
}

type ResizeDrag = {
  pointerId: number
  startX: number
  startWidth: number
}

export function Sidebar({ children }: SidebarProps) {
  const [open, setOpen] = useState(true)
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [maxWidth, setMaxWidth] = useState(SIDEBAR_MAX_WIDTH)
  const drag = useRef<ResizeDrag | null>(null)
  const sidebarId = useId()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const displayedWidth = clampSidebarWidth(width, maxWidth)

  useEffect(() => {
    const updateMaxWidth = () => setMaxWidth(sidebarMaxWidth(window.innerWidth))
    updateMaxWidth()
    window.addEventListener('resize', updateMaxWidth)
    return () => window.removeEventListener('resize', updateMaxWidth)
  }, [])

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return
    event.preventDefault()
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: displayedWidth,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    setWidth(
      clampSidebarWidth(
        active.startWidth + event.clientX - active.startX,
        maxWidth,
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
    const nextWidth = sidebarWidthForKey(event.key, displayedWidth, maxWidth)
    if (nextWidth === null) return
    event.preventDefault()
    setWidth(nextWidth)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-4 items-center border-b border-solid-gray-300 bg-white px-4 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={sidebarId}
          onClick={() => setOpen((current) => !current)}
          className="flex min-h-11 items-center gap-2 rounded-8 px-3 font-bold text-key-900 hover:bg-solid-gray-50 focus-visible:outline focus-visible:outline-4 focus-visible:outline-black focus-visible:outline-offset-2 focus-visible:ring-4 focus-visible:ring-yellow-300"
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
          {open ? 'メニューを閉じる' : 'メニューを開く'}
        </button>
        <Heading hasChip={false} size="20">
          <HeadingTitle level="h2">リポジトリ業務メニュー</HeadingTitle>
        </Heading>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <aside
          id={sidebarId}
          hidden={!open}
          style={{ width: displayedWidth }}
          className="absolute inset-y-0 left-0 z-20 shrink-0 border-r border-solid-gray-300 bg-white shadow-md md:relative md:inset-auto md:z-auto md:shadow-none"
        >
          <nav
            aria-label="サイドナビゲーション"
            className="max-h-full overflow-y-auto p-4"
          >
            <MenuList>
              {navigation.map((item) => {
                const current =
                  pathname.replace(/\/$/, '') === item.to.replace(/\/$/, '')
                return (
                  <MenuListItem key={item.to}>
                    <SidebarLink
                      to={item.to}
                      type="standard"
                      size="regular"
                      current={current}
                      aria-current={current ? 'page' : undefined}
                      className="truncate"
                    >
                      {item.label}
                    </SidebarLink>
                  </MenuListItem>
                )
              })}
            </MenuList>
          </nav>
          <div
            role="separator"
            tabIndex={0}
            aria-label="サイドバーの幅を調整"
            aria-orientation="vertical"
            aria-controls={sidebarId}
            aria-valuemin={Math.min(SIDEBAR_MIN_WIDTH, maxWidth)}
            aria-valuemax={maxWidth}
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
            className="absolute inset-y-0 -right-2.5 z-10 flex w-5 touch-none cursor-col-resize items-center justify-center focus-visible:outline focus-visible:outline-4 focus-visible:outline-black focus-visible:ring-4 focus-visible:ring-yellow-300"
          >
            <span
              aria-hidden="true"
              className="h-12 w-1 rounded-full bg-solid-gray-420"
            />
          </div>
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
