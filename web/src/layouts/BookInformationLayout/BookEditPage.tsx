import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../atoms/Button'
import {
  SearchBox,
  SearchBoxFields,
  SearchBoxInput,
  SearchBoxSelect,
  SearchBoxSubmit,
} from '../../atoms/SearchBox'
import { BookInformationLayout } from './BookInformationLayout'
import {
  resolveBookInformationId,
  type BookIdInputKind,
  type LookupBookId,
} from './bookIdLookup'

export type BookEditPageProps = {
  bookId: string
  lookupBookId?: LookupBookId
  onResolved?: (bookId: string) => void
}

export function BookEditPage({
  bookId,
  lookupBookId,
  onResolved,
}: BookEditPageProps) {
  const [input, setInput] = useState(bookId)
  const [kind, setKind] = useState<BookIdInputKind>('bibliographic')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const request = useRef(0)
  const composing = useRef(false)

  useEffect(
    () => () => {
      request.current++
    },
    [],
  )

  function resetSearch() {
    request.current++
    setPending(false)
    setMessage('')
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (composing.current) return
    const sequence = ++request.current
    setMessage('')
    setPending(true)
    try {
      const result = await resolveBookInformationId(kind, input, lookupBookId)
      if (sequence !== request.current) return
      if (result.status === 'resolved') {
        setInput(result.bookId)
        setKind('bibliographic')
        if (onResolved) onResolved(result.bookId)
        else setMessage('書誌情報の検索は準備中です。')
      } else {
        const messages = {
          empty: 'ID を入力してください。',
          'invalid-id': '書誌情報 ID の形式を確認してください。',
          'not-found': '該当する書誌情報が見つかりませんでした。',
          unavailable: '書籍 ID からの検索は準備中です。',
        }
        setMessage(messages[result.status])
      }
    } catch {
      if (sequence === request.current)
        setMessage('検索できませんでした。もう一度お試しください。')
    } finally {
      if (sequence === request.current) setPending(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form onSubmit={handleSearch} className="m-4 shrink-0">
        <SearchBox size="lg">
          <SearchBoxFields className="min-w-0">
            <SearchBoxSelect
              label="検索キー"
              value={kind}
              onChange={(event) => {
                const nextKind = event.target.value as BookIdInputKind
                resetSearch()
                setKind(nextKind)
                setInput(nextKind === 'bibliographic' ? bookId : '')
              }}
            >
              <option value="bibliographic">書誌情報 ID</option>
              <option value="copy">配架の書籍 ID</option>
            </SearchBoxSelect>
            <SearchBoxInput
              label={kind === 'bibliographic' ? '書誌情報 ID' : '配架の書籍 ID'}
              name="id"
              type="search"
              value={input}
              onChange={(event) => {
                resetSearch()
                setInput(event.target.value)
              }}
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={() => {
                composing.current = false
              }}
            />
          </SearchBoxFields>
          <SearchBoxSubmit
            size="lg"
            type="submit"
            variant="outline"
            disabled={pending}
          >
            検索
          </SearchBoxSubmit>
        </SearchBox>
        {message && (
          <p role="status" className="mt-2 text-solid-gray-700">
            {message}
          </p>
        )}
      </form>
      {bookId && (
        <p className="mx-4 text-solid-gray-700">
          書誌情報の読み込みは準備中です。
        </p>
      )}
      <div className="min-h-0 flex-1">
        <BookInformationLayout bookId={bookId} />
      </div>
      <div
        role="group"
        aria-label="書籍の操作"
        className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-solid-gray-300 bg-white px-4 py-3"
      >
        <Button type="button" size="md" variant="outline">
          保存
        </Button>
      </div>
    </div>
  )
}
