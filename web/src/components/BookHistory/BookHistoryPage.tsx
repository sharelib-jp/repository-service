import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionSummary,
} from '../../atoms/Accordion'
import { Button } from '../../atoms/Button'
import { Heading, HeadingTitle } from '../../atoms/Heading'
import {
  SearchBox,
  SearchBoxFields,
  SearchBoxInput,
} from '../../atoms/SearchBox'
import {
  diffSnapshots,
  historiesForBook,
  type BookHistoryEntry,
  type SnapshotValue,
} from './bookHistory'

export type LoadBookHistory = (
  bookId: string,
  signal: AbortSignal,
) => Promise<readonly BookHistoryEntry[]>
export type BookHistoryPageProps = {
  initialBookId?: string
  history?: readonly BookHistoryEntry[]
  loadHistory?: LoadBookHistory
}

type LoadState =
  | { bookId: string; status: 'loading' | 'error' }
  | { bookId: string; status: 'ready'; entries: readonly BookHistoryEntry[] }

const operations = { create: '登録', update: '更新', delete: '削除' }
const kinds = { added: '追加', removed: '削除', changed: '変更' }
const entityLabels = {
  book: '書誌情報',
  book_copy: '蔵書情報',
  copy: '蔵書情報',
}

function displayTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP')
}

function Value({ item }: { item: SnapshotValue }) {
  if (!item.exists)
    return <span className="text-solid-gray-700">（項目なし）</span>
  return (
    <pre className="m-0 whitespace-pre-wrap break-all font-mono">
      {JSON.stringify(item.value, null, 2)}
    </pre>
  )
}

export function BookHistoryPage({
  initialBookId = '',
  history,
  loadHistory,
}: BookHistoryPageProps) {
  const [input, setInput] = useState(initialBookId)
  const [bookId, setBookId] = useState(initialBookId.trim())
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<LoadState | null>(null)
  const [error, setError] = useState('')
  const composing = useRef(false)

  useEffect(() => {
    if (!bookId || !loadHistory) return
    const controller = new AbortController()
    setLoaded({ bookId, status: 'loading' })
    loadHistory(bookId, controller.signal).then(
      (entries) => {
        if (!controller.signal.aborted)
          setLoaded({ bookId, status: 'ready', entries })
      },
      () => {
        if (!controller.signal.aborted) setLoaded({ bookId, status: 'error' })
      },
    )
    return () => controller.abort()
  }, [bookId, attempt, loadHistory])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (composing.current) return
    const id = input.trim()
    if (!id) {
      setError('書籍 ID を入力してください。')
      return
    }
    setError('')
    setBookId(id)
    setAttempt((current) => current + 1)
  }

  const isLoading = Boolean(
    bookId &&
    loadHistory &&
    (loaded?.bookId !== bookId || loaded.status === 'loading'),
  )
  const loadError = Boolean(
    bookId &&
    loadHistory &&
    loaded?.bookId === bookId &&
    loaded.status === 'error',
  )
  const data = loadHistory
    ? loaded?.bookId === bookId && loaded.status === 'ready'
      ? loaded.entries
      : undefined
    : history
  const entries = bookId && data ? historiesForBook(data, bookId) : []
  const unavailable = !loadHistory && history === undefined

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 p-4">
      <Heading hasChip size="24">
        <HeadingTitle level="h1">単件蔵書変更履歴</HeadingTitle>
      </Heading>
      <form onSubmit={submit} className="shrink-0">
        <SearchBox size="md">
          <SearchBoxFields className="min-w-0">
            <SearchBoxInput
              label="書籍 ID"
              type="search"
              className="min-w-0"
              placeholder="書籍 ID を入力"
              value={input}
              onChange={(event) => {
                setInput(event.target.value)
                setError('')
              }}
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={() => {
                composing.current = false
              }}
            />
          </SearchBoxFields>
          <Button
            type="submit"
            size="md"
            variant="solid-fill"
            disabled={isLoading}
            className="[grid-area:submit]"
          >
            検索
          </Button>
        </SearchBox>
        {error && (
          <p role="alert" className="mt-2 text-error-1">
            {error}
          </p>
        )}
      </form>
      {unavailable && (
        <p role="status" className="shrink-0 text-solid-gray-700">
          変更履歴の読み込みは準備中です。
        </p>
      )}
      {isLoading && (
        <p role="status" className="shrink-0">
          変更履歴を読み込んでいます。
        </p>
      )}
      {loadError && (
        <p role="alert" className="shrink-0 text-error-1">
          変更履歴を読み込めませんでした。もう一度検索してください。
        </p>
      )}
      {!bookId && (
        <p className="text-solid-gray-700">
          書籍 ID を入力して変更履歴を検索してください。
        </p>
      )}
      {bookId && data && (
        <div className="min-h-0 flex-1 overflow-auto">
          <p className="mb-3" aria-live="polite">
            書籍 ID: {bookId}　{entries.length} 件
          </p>
          {entries.length === 0 ? (
            <p className="text-solid-gray-700">
              この書籍の変更履歴はありません。
            </p>
          ) : (
            entries.map((entry) => {
              const differences = diffSnapshots(
                entry.beforeData,
                entry.afterData,
              )
              return (
                <Accordion key={entry.id}>
                  <AccordionSummary>
                    <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <time dateTime={entry.changedAt}>
                        {displayTime(entry.changedAt)}
                      </time>
                      <span className="font-bold">
                        {operations[entry.operation]}
                      </span>
                      {entry.entityType && (
                        <span>{entityLabels[entry.entityType]}</span>
                      )}
                      <span>変更者: {entry.actor || '不明'}</span>
                      <span>{differences.length} 項目</span>
                    </span>
                  </AccordionSummary>
                  <AccordionContent>
                    {entry.reason && (
                      <p className="mb-3">変更理由: {entry.reason}</p>
                    )}
                    {differences.length === 0 ? (
                      <p>表示できる変更はありません。</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[40rem] table-fixed border-collapse text-dns-16N-130">
                          <caption className="sr-only">
                            {displayTime(entry.changedAt)}の変更内容
                          </caption>
                          <thead>
                            <tr className="border-b border-black bg-solid-gray-100">
                              <th scope="col" className="w-1/4 p-3 text-left">
                                項目
                              </th>
                              <th scope="col" className="w-20 p-3 text-left">
                                種類
                              </th>
                              <th scope="col" className="p-3 text-left">
                                変更前
                              </th>
                              <th scope="col" className="p-3 text-left">
                                変更後
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {differences.map((difference) => (
                              <tr
                                key={JSON.stringify(difference.path)}
                                className="border-b border-solid-gray-300 align-top"
                              >
                                <th
                                  scope="row"
                                  className="break-all p-3 text-left"
                                >
                                  {difference.path.length
                                    ? difference.path.join(' › ')
                                    : '全体'}
                                </th>
                                <td className="p-3">
                                  {kinds[difference.kind]}
                                </td>
                                <td className="bg-solid-gray-50 p-3">
                                  <Value item={difference.before} />
                                </td>
                                <td className="p-3">
                                  <Value item={difference.after} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </AccordionContent>
                </Accordion>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
