import { useNavigate } from '@tanstack/react-router'
import { lookupBookId as apiLookupBookId } from '../../api/books'
import { useBookEditor } from './useBookEditor'
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
  lookupBookId = apiLookupBookId,
  onResolved,
}: BookEditPageProps) {
  const navigate = useNavigate()
  const editor = useBookEditor(bookId)
  const [input, setInput] = useState(bookId)
  const [kind, setKind] = useState<BookIdInputKind>('bibliographic')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const request = useRef(0)
  const composing = useRef(false)
  useEffect(() => {
    setInput(bookId)
    setKind('bibliographic')
  }, [bookId])

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
    if (composing.current || editor.saving) return
    const sequence = ++request.current
    setMessage('')
    setPending(true)
    try {
      const result = await resolveBookInformationId(kind, input, lookupBookId)
      if (sequence !== request.current) return
      if (result.status === 'resolved') {
        setInput(result.bookId)
        setKind('bibliographic')
        if (
          editor.dirty &&
          !window.confirm('未保存の変更を破棄して別の書誌を開きますか？')
        )
          return
        if (onResolved) {
          if (await editor.load(result.bookId)) onResolved(result.bookId)
        } else if (result.bookId === bookId) await editor.load(result.bookId)
        else
          await navigate({
            to: '/books/edit/$bookId',
            params: { bookId: result.bookId },
          })
      } else {
        const messages = {
          empty: 'ID を入力してください。',
          'invalid-id': '書誌情報 ID の形式を確認してください。',
          'not-found': '該当する書誌情報が見つかりませんでした。',
          unavailable: '書籍 ID から検索できませんでした。',
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
        <fieldset disabled={editor.saving} className="min-w-0 border-0 p-0">
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
                autoFocus
                label={
                  kind === 'bibliographic' ? '書誌情報 ID' : '配架の書籍 ID'
                }
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
        </fieldset>
        {message && (
          <p role="status" className="mt-2 text-solid-gray-700">
            {message}
          </p>
        )}
      </form>
      <div className="min-h-0 flex-1">
        <BookInformationLayout
          key={editor.revision}
          value={editor.draft}
          onChange={editor.change}
          onBeginAuthorityEdit={editor.cancelLookup}
          busy={editor.loading || editor.saving || !editor.draft.saved?.id}
        />
      </div>
      <div className="shrink-0 border-t border-solid-gray-300 bg-white px-4 py-3">
        {editor.loading && <p role="status">書誌情報を読み込んでいます…</p>}
        {editor.error && (
          <p role="alert" className="mb-2 text-error-1">
            {editor.error}
          </p>
        )}
        {editor.message && (
          <p role="status" className="mb-2">
            {editor.message}
          </p>
        )}
        <div
          role="group"
          aria-label="書籍の操作"
          className="flex flex-wrap items-center justify-end gap-3"
        >
          <Button
            type="button"
            size="md"
            variant="outline"
            disabled={
              pending ||
              editor.loading ||
              editor.saving ||
              !editor.draft.saved?.id
            }
            onClick={async () => {
              if (
                !window.confirm(
                  `「${editor.draft.title}」の書誌情報を削除しますか？`,
                )
              )
                return
              if (await editor.remove())
                await navigate({
                  to: '/books',
                  search: { authorId: '', authorName: '' },
                })
            }}
          >
            削除
          </Button>
          <Button
            type="button"
            size="md"
            variant="outline"
            disabled={
              pending ||
              editor.loading ||
              editor.saving ||
              !editor.draft.saved?.id
            }
            onClick={() => {
              if (
                editor.dirty &&
                !window.confirm('未保存の変更を破棄して読み直しますか？')
              )
                return
              if (editor.draft.saved?.id)
                void editor.load(editor.draft.saved.id)
            }}
          >
            再読み込み
          </Button>
          <Button
            type="button"
            size="md"
            variant="outline"
            disabled={
              pending ||
              editor.loading ||
              editor.saving ||
              editor.resolving ||
              !editor.draft.saved?.id
            }
            onClick={() => void editor.save()}
          >
            {editor.saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  )
}
