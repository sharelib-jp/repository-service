import { useState } from 'react'
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
  SearchBoxDetail,
  SearchBoxDetailActions,
  SearchBoxFields,
  SearchBoxInput,
} from '../../atoms/SearchBox'
import { Select } from '../../atoms/Select'
import { EditableTable, type EditableTableColumn } from '../EditableTable'
import { filterBooks, type BookListItem, type BookListSearch } from './bookList'

const PAGE_SIZE = 20
const emptySearch: BookListSearch = { keyword: '', status: '', loanHistory: '' }
const columns: readonly EditableTableColumn<
  BookListItem,
  keyof BookListItem | 'history'
>[] = [
  {
    key: 'bookId',
    label: '書籍 ID',
    getValue: (book) => book.bookId,
    renderCell: (book) => book.bookId,
  },
  {
    key: 'title',
    label: 'タイトル',
    getValue: (book) => book.title,
    renderCell: (book) => book.title,
  },
  {
    key: 'author',
    label: '著者名',
    getValue: (book) => book.author,
    renderCell: (book) => book.author,
  },
  {
    key: 'publisher',
    label: '出版社',
    getValue: (book) => book.publisher,
    renderCell: (book) => book.publisher,
  },
  {
    key: 'updatedAt',
    label: '最終更新日',
    getValue: (book) => book.updatedAt,
    renderCell: (book) => book.updatedAt,
  },
  {
    key: 'status',
    label: '状態',
    getValue: (book) => book.status,
    renderCell: (book) => book.status,
  },
  {
    key: 'loanLabel',
    label: '貸出ラベル',
    getValue: (book) => book.loanLabel,
    renderCell: (book) => book.loanLabel,
  },
  {
    key: 'bibliographicId',
    label: '編集ボタン',
    getValue: (book) => book.bibliographicId,
    renderCell: (book) => (
      <Button asChild size="sm" variant="outline">
        <Link
          to="/books/edit/$bookId"
          params={{ bookId: book.bibliographicId }}
          aria-label={`${book.title}（${book.bookId}）を編集`}
        >
          編集
        </Link>
      </Button>
    ),
  },
  {
    key: 'history',
    label: '変更履歴',
    getValue: (book) => book.bookId,
    renderCell: (book) => (
      <Button asChild size="sm" variant="outline">
        <Link
          to="/books/history"
          search={{ bookId: book.bookId }}
          aria-label={`${book.title}（${book.bookId}）の変更履歴`}
        >
          履歴
        </Link>
      </Button>
    ),
  },
]
const getRowKey = (book: BookListItem) => book.bookId

// The list API has not been implemented yet. A data source can be supplied when it is available.
export function BookListPage({
  books,
  authorId = '',
  authorName = '',
}: {
  books?: readonly BookListItem[]
  authorId?: string
  authorName?: string
}) {
  const [draft, setDraft] = useState<BookListSearch>(emptySearch)
  const [search, setSearch] = useState<BookListSearch>(emptySearch)
  const [page, setPage] = useState(1)
  const filtered = filterBooks(books ?? [], { ...search, authorId })
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageBooks = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSearch(draft)
    setPage(1)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 p-4">
      <Heading hasChip size="24">
        <HeadingTitle level="h1">登録済み蔵書一覧</HeadingTitle>
      </Heading>
      <form onSubmit={handleSearch} className="relative z-20 shrink-0">
        <SearchBox
          size="md"
          className="relative grid-cols-[1fr_auto] gap-y-2 ![grid-template-areas:'fields_fields'_'detail_submit'] sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:![grid-template-areas:'fields_detail_submit']"
        >
          <SearchBoxFields className="min-w-0">
            <SearchBoxInput
              label="書籍を検索"
              type="search"
              className="min-w-0"
              placeholder="書籍 ID、タイトル、著者名、出版社"
              value={draft.keyword}
              onChange={(event) =>
                setDraft({ ...draft, keyword: event.target.value })
              }
            />
          </SearchBoxFields>
          <SearchBoxDetail
            summary="詳細検索"
            className="!mt-0 justify-self-end whitespace-nowrap open:!pb-3 [&>div]:absolute [&>div]:right-0 [&>div]:top-full [&>div]:z-20 [&>div]:mt-2 [&>div]:max-h-[50vh] [&>div]:w-[min(24rem,100%)] [&>div]:overflow-y-auto [&>div]:whitespace-normal [&>div]:rounded-8 [&>div]:border [&>div]:border-solid-gray-300 [&>div]:bg-white [&>div]:p-4 [&>div]:shadow-lg"
          >
            <div className="mb-6 flex flex-wrap gap-6">
              <label className="flex flex-col gap-2">
                状態
                <Select
                  blockSize="md"
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value })
                  }
                >
                  <option value="">すべて</option>
                  {['問題なし', '紛失', '汚損・破損', '盗難', '不明'].map(
                    (status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ),
                  )}
                </Select>
              </label>
              <label className="flex flex-col gap-2">
                貸出履歴
                <Select
                  blockSize="md"
                  value={draft.loanHistory}
                  onChange={(event) =>
                    setDraft({ ...draft, loanHistory: event.target.value })
                  }
                >
                  <option value="">すべて</option>
                  <option value="yes">あり</option>
                  <option value="no">なし</option>
                </Select>
              </label>
            </div>
            <SearchBoxDetailActions>
              <Button size="md" type="submit" variant="solid-fill">
                この条件で検索
              </Button>
            </SearchBoxDetailActions>
          </SearchBoxDetail>
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
      {authorId && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-8 bg-solid-gray-50 px-4 py-2">
          <p>
            著者典拠: {authorName || authorId}（ID: {authorId}）
          </p>
          <Link
            to="/books"
            search={{ authorId: '', authorName: '' }}
            className="text-key-900 underline focus-visible:outline focus-visible:outline-4 focus-visible:outline-black"
          >
            著者の条件を解除
          </Link>
        </div>
      )}
      {books === undefined && (
        <p role="status" className="shrink-0 text-solid-gray-700">
          書籍一覧の読み込みは準備中です。
        </p>
      )}
      <div className="min-h-0 min-w-0 flex-1">
        <EditableTable
          caption="登録済み蔵書一覧"
          columns={columns}
          rows={pageBooks}
          getRowKey={getRowKey}
          selectable={false}
          scrollable
          emptyMessage={
            books === undefined
              ? '表示できる書籍はありません。'
              : '条件に一致する書籍はありません。'
          }
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-solid-gray-300 pt-2">
        <p aria-live="polite">
          {books === undefined ? '—' : filtered.length} 件
        </p>
        <PageNavigation aria-label="書籍一覧のページ">
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
    </div>
  )
}
