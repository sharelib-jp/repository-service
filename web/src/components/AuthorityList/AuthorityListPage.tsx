import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAuthorities } from '../../api/catalogLists'
import { saveAuthority } from '../../api/authorities'
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
import {
  AuthorityDialog,
  type Authority,
  type AuthorityKind,
} from '../AuthorityDialog'
import { EditableTable, type EditableTableColumn } from '../EditableTable'
import { filterAuthorities, type AuthorityListItem } from './authorityList'

const PAGE_SIZE = 20
const typeLabels: Record<Authority['type'], string> = {
  Person: '人物',
  Organization: '団体',
  Other: 'その他・不明',
}
const getRowKey = (author: AuthorityListItem) => author.id

export function AuthorityListPage({
  kind,
  authorities,
  onAuthorityChange,
}: {
  kind: AuthorityKind
  authorities?: readonly AuthorityListItem[]
  onAuthorityChange?: (author: AuthorityListItem) => void | Promise<void>
}) {
  const label = kind === 'author' ? '著者' : '出版社'
  const [draft, setDraft] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Map<string, AuthorityListItem>>(
    () => new Map(),
  )
  const [edited, setEdited] = useState(false)
  const remote = useQuery({
    queryKey: ['authorities', kind, keyword, page],
    queryFn: ({ signal }) =>
      listAuthorities(kind, keyword, page, PAGE_SIZE, signal),
    enabled: authorities === undefined,
    refetchOnWindowFocus: editingId === null,
    retry: false,
  })
  const available = (authorities ?? remote.data?.items ?? []).map(
    (author) => overrides.get(author.id) ?? author,
  )
  const filtered = filterAuthorities(available, keyword)
  const total =
    authorities === undefined ? (remote.data?.total ?? 0) : filtered.length
  const loading = authorities === undefined && remote.isFetching
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageAuthors =
    authorities === undefined
      ? available
      : filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  useEffect(() => {
    if (authorities === undefined && remote.data && page > totalPages)
      setPage(totalPages)
  }, [authorities, remote.data, page, totalPages])
  const selected = available.find((author) => author.id === editingId)
  // The dialog copies its value on open; keep the input stable while editing.
  const dialogValue = useMemo(() => (selected ? [selected] : []), [selected])

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (authorities === undefined && keyword === draft && page === 1)
      void remote.refetch()
    setKeyword(draft)
    setPage(1)
  }

  const columns: readonly EditableTableColumn<
    AuthorityListItem,
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
    ...(kind === 'author'
      ? ([
          {
            key: 'books',
            label: '書籍検索',
            getValue: () => '',
            renderCell: (author: AuthorityListItem) => (
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
        ] as const)
      : []),
  ]

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 p-4">
      <Heading hasChip size="24">
        <HeadingTitle level="h1">登録{label}典拠一覧</HeadingTitle>
      </Heading>
      <form onSubmit={handleSearch} className="shrink-0">
        <SearchBox size="md">
          <SearchBoxFields className="min-w-0">
            <SearchBoxInput
              label={`${label}典拠を検索`}
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
      {authorities === undefined && (loading || remote.error) && (
        <p
          role={remote.error ? 'alert' : 'status'}
          className="shrink-0 text-solid-gray-700"
        >
          {loading
            ? `${label}典拠一覧を読み込んでいます。`
            : remote.error?.message}
        </p>
      )}
      {edited && !onAuthorityChange && (
        <p role="status" className="shrink-0 text-solid-gray-700">
          {authorities === undefined
            ? '典拠情報を保存しました。'
            : '変更はこの画面内に反映されています。'}
        </p>
      )}
      <div className="min-h-0 min-w-0 flex-1">
        <EditableTable
          caption={`登録${label}典拠一覧`}
          columns={columns}
          rows={pageAuthors}
          getRowKey={getRowKey}
          selectable={false}
          scrollable
          emptyMessage={
            loading
              ? '読み込み中です。'
              : `条件に一致する${label}典拠はありません。`
          }
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-solid-gray-300 pt-2">
        <p aria-live="polite">{total} 件</p>
        <PageNavigation aria-label={`${label}典拠一覧のページ`}>
          <PageNavigationButton
            control="prev"
            size="sm"
            type="button"
            variant="outline"
            disabled={loading || currentPage === 1}
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
            disabled={loading || currentPage === totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            次のページ
          </PageNavigationButton>
        </PageNavigation>
      </div>
      <AuthorityDialog
        mode="edit"
        kind={kind}
        open={editingId !== null && Boolean(selected)}
        value={dialogValue}
        onOpenChange={(open) => {
          if (!open) setEditingId(null)
        }}
        onApply={async (rows) => {
          const updated = rows[0]
          if (!updated || !selected) return
          const next =
            authorities === undefined && !onAuthorityChange
              ? await saveAuthority({ ...selected, ...updated }, kind)
              : { ...selected, ...updated }
          await onAuthorityChange?.(next)
          if (authorities === undefined) {
            void remote.refetch()
          } else
            setOverrides((current) => new Map(current).set(selected.id, next))
          setEdited(true)
        }}
      />
    </div>
  )
}
