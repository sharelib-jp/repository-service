import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '../../atoms/Button'
import { Heading, HeadingTitle } from '../../atoms/Heading'
import {
  PageNavigation,
  PageNavigationButton,
  PageNavigationCounter,
} from '../../atoms/PageNavigation'
import {
  SearchBox,
  SearchBoxFields,
  SearchBoxInput,
} from '../../atoms/SearchBox'
import { AuthorityDialog, type Authority } from '../AuthorityDialog'
import { EditableTable, type EditableTableColumn } from '../EditableTable'
import { filterAuthors, type AuthorListItem } from './authorList'

const PAGE_SIZE = 20
const typeLabels: Record<Authority['type'], string> = {
  Person: '人物',
  Organization: '団体',
  Other: 'その他・不明',
}
const getRowKey = (author: AuthorListItem) => author.id

export function AuthorListPage({
  authors,
  onAuthorChange,
}: {
  authors?: readonly AuthorListItem[]
  onAuthorChange?: (author: AuthorListItem) => void
}) {
  const [draft, setDraft] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Map<string, AuthorListItem>>(
    () => new Map(),
  )
  const [edited, setEdited] = useState(false)
  const available = (authors ?? []).map(
    (author) => overrides.get(author.id) ?? author,
  )
  const filtered = filterAuthors(available, keyword)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageAuthors = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )
  const selected = available.find((author) => author.id === editingId)
  // The dialog copies its value on open; keep the input stable while editing.
  const dialogValue = useMemo(() => (selected ? [selected] : []), [selected])

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setKeyword(draft)
    setPage(1)
  }

  const columns: readonly EditableTableColumn<
    AuthorListItem,
    | 'id'
    | 'title'
    | 'transcription'
    | 'type'
    | 'language'
    | 'updatedAt'
    | 'edit'
    | 'books'
  >[] = [
    {
      key: 'id',
      label: '典拠 ID',
      getValue: (author) => author.id,
      renderCell: (author) => author.id,
    },
    {
      key: 'title',
      label: '典拠タイトル',
      getValue: (author) => author.title,
      renderCell: (author) => author.title,
    },
    {
      key: 'transcription',
      label: 'タイトルヨミ',
      getValue: (author) => author.transcription,
      renderCell: (author) => author.transcription || '—',
    },
    {
      key: 'type',
      label: '種別',
      getValue: (author) => author.type,
      renderCell: (author) => typeLabels[author.type],
    },
    {
      key: 'language',
      label: '言語',
      getValue: (author) => author.language,
      renderCell: (author) => author.language || '—',
    },
    {
      key: 'updatedAt',
      label: '最終更新日時',
      getValue: (author) => author.updatedAt ?? '',
      renderCell: (author) => author.updatedAt || '—',
    },
    {
      key: 'edit',
      label: '編集',
      getValue: () => '',
      renderCell: (author) => (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`${author.title}を編集`}
          onClick={() => setEditingId(author.id)}
        >
          編集
        </Button>
      ),
    },
    {
      key: 'books',
      label: '書籍検索',
      getValue: () => '',
      renderCell: (author) => (
        <Button asChild size="sm" variant="outline">
          <Link
            to="/books"
            search={{ authorId: author.id, authorName: author.title }}
            aria-label={`${author.title}の書籍を検索`}
          >
            書籍を検索
          </Link>
        </Button>
      ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 p-4">
      <Heading hasChip size="24">
        <HeadingTitle level="h1">登録著者典拠一覧</HeadingTitle>
      </Heading>
      <form onSubmit={handleSearch} className="shrink-0">
        <SearchBox size="md">
          <SearchBoxFields className="min-w-0">
            <SearchBoxInput
              label="著者典拠を検索"
              type="search"
              className="min-w-0"
              placeholder="典拠 ID、名前、ヨミ、別名、参照情報"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </SearchBoxFields>
          <Button
            size="md"
            type="submit"
            variant="solid-fill"
            className="[grid-area:submit]"
          >
            検索
          </Button>
        </SearchBox>
      </form>
      {authors === undefined && (
        <p role="status" className="shrink-0 text-solid-gray-700">
          著者典拠一覧の読み込みは準備中です。
        </p>
      )}
      {edited && !onAuthorChange && (
        <p role="status" className="shrink-0 text-solid-gray-700">
          変更はこの画面内に反映されています。
        </p>
      )}
      <div className="min-h-0 min-w-0 flex-1">
        <EditableTable
          caption="登録著者典拠一覧"
          columns={columns}
          rows={pageAuthors}
          getRowKey={getRowKey}
          selectable={false}
          scrollable
          emptyMessage={
            authors === undefined
              ? '表示できる著者典拠はありません。'
              : '条件に一致する著者典拠はありません。'
          }
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-solid-gray-300 pt-2">
        <p aria-live="polite">
          {authors === undefined ? '—' : filtered.length} 件
        </p>
        <PageNavigation aria-label="著者典拠一覧のページ">
          <PageNavigationButton
            control="prev"
            size="sm"
            type="button"
            variant="outline"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            前のページ
          </PageNavigationButton>
          <PageNavigationCounter aria-live="polite">
            {currentPage} / {totalPages}
          </PageNavigationCounter>
          <PageNavigationButton
            control="next"
            size="sm"
            type="button"
            variant="outline"
            disabled={currentPage === totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            次のページ
          </PageNavigationButton>
        </PageNavigation>
      </div>
      <AuthorityDialog
        mode="edit"
        kind="author"
        open={editingId !== null && Boolean(selected)}
        value={dialogValue}
        onOpenChange={(open) => {
          if (!open) setEditingId(null)
        }}
        onApply={(rows) => {
          const updated = rows[0]
          if (!updated || !selected) return
          const next = { ...selected, ...updated }
          setOverrides((current) => new Map(current).set(selected.id, next))
          setEdited(true)
          onAuthorChange?.(next)
        }}
      />
    </div>
  )
}
