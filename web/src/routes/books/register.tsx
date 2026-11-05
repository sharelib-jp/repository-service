import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { externalSources, type ExternalSource } from '../../api/authorities'
import {
  searchExternalBooks,
  externalBookDetails,
  type ExternalBook,
} from '../../api/externalBooks'
import {
  SearchBox,
  SearchBoxFields,
  SearchBoxInput,
  SearchBoxSelect,
  SearchBoxSubmit,
} from '../../atoms/SearchBox'
import { Button } from '../../atoms/Button'
import { SelectionDialog } from '../../components/SelectionDialog'
import { BookInformationLayout } from '../../layouts/BookInformationLayout'
import { useBookEditor } from '../../layouts/BookInformationLayout/useBookEditor'

export const Route = createFileRoute('/books/register')({
  component: RouteComponent,
})

const fieldLabels: Record<string, string> = {
  isbn: 'ISBN',
  title: 'タイトル',
  creator: '著者',
  keyword: 'キーワード',
}

function RouteComponent() {
  const navigate = useNavigate()
  const editor = useBookEditor()
  const [sources, setSources] = useState<ExternalSource[]>([])
  const [sourceName, setSourceName] = useState('')
  const [field, setField] = useState('')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [results, setResults] = useState<ExternalBook[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [resultPage, setResultPage] = useState(1)
  const [dialogError, setDialogError] = useState('')
  const [failedDetail, setFailedDetail] = useState<ExternalBook>()
  const [lastSearch, setLastSearch] = useState<{
    source: string
    field: string
    query: string
  }>()
  const request = useRef<AbortController | null>(null)
  const composing = useRef(false)
  const source = sources.find((item) => item.name === sourceName)

  useEffect(() => {
    const controller = new AbortController()
    externalSources('books', controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setSources(items)
        const initial = items.find((item) => item.name === 'ndl') ?? items[0]
        setSourceName(initial?.name ?? '')
        setField(
          initial?.queryFields.includes('isbn')
            ? 'isbn'
            : (initial?.queryFields[0] ?? ''),
        )
        if (!initial) setMessage('利用できる書誌検索ソースがありません。')
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage('検索ソースを取得できませんでした。')
      })
    return () => {
      controller.abort()
      request.current?.abort()
    }
  }, [])

  function applyBook(book: ExternalBook, fallback = false) {
    void editor.importBook(book)
    setFailedDetail(undefined)
    setDialogOpen(false)
    setMessage(
      fallback
        ? '検索結果に含まれる DC-NDL の情報を反映しました。'
        : '書誌情報を反映しました。',
    )
  }

  async function selectBook(book: ExternalBook) {
    request.current?.abort()
    setFailedDetail(undefined)
    setDialogError('')
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    try {
      const selected = book.detailId
        ? await externalBookDetails(
            book.source,
            book.detailId,
            controller.signal,
          )
        : book
      if (!controller.signal.aborted) applyBook(selected)
    } catch (error) {
      if (controller.signal.aborted) return
      const text =
        error instanceof Error
          ? error.message
          : '書誌の個別取得に失敗しました。'
      setDialogError(text)
      setMessage(text)
      setFailedDetail(book)
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (composing.current) return
    request.current?.abort()
    setFailedDetail(undefined)
    setDialogError('')
    const term = query.trim()
    if (!term || !source || !field) {
      setMessage('検索先、検索キー、検索語を指定してください。')
      setPending(false)
      return
    }
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setMessage('')
    try {
      const items = await searchExternalBooks(
        source.name,
        field,
        term,
        1,
        controller.signal,
      )
      if (controller.signal.aborted) return
      setResults(items)
      setLastSearch({ source: source.name, field, query: term })
      setResultPage(1)
      setDialogError('')
      if (!items.length) setMessage('一致する書誌情報が見つかりませんでした。')
      else if (items.length === 1) await selectBook(items[0])
      else setDialogOpen(true)
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : '書誌情報を検索できませんでした。時間をおいて再度お試しください。',
        )
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  async function changePage(page: number) {
    if (!lastSearch || page < 1) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setDialogError('')
    try {
      const items = await searchExternalBooks(
        lastSearch.source,
        lastSearch.field,
        lastSearch.query,
        page,
        controller.signal,
      )
      if (controller.signal.aborted) return
      if (!items.length) setDialogError('これ以降の候補はありません。')
      else {
        setResults(items)
        setResultPage(page)
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setDialogError(
          error instanceof Error
            ? error.message
            : '候補を取得できませんでした。',
        )
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  function clearForm() {
    if (editor.dirty && !window.confirm('入力内容をクリアしますか？')) return
    request.current?.abort()
    setPending(false)
    editor.reset()
    setQuery('')
    setResults([])
    setFailedDetail(undefined)
    setMessage('')
  }
  async function save(next: boolean) {
    if (pending) return
    const saved = await editor.save()
    if (!saved?.id) return
    if (next) {
      editor.reset()
      setQuery('')
      setResults([])
      setFailedDetail(undefined)
      setMessage('保存しました。次の書誌を登録できます。')
    } else {
      try {
        await navigate({
          to: '/books/edit/$bookId',
          params: { bookId: saved.id },
        })
      } catch {
        setMessage(`保存しました。書誌情報 ID: ${saved.id}`)
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form className="m-4 shrink-0" onSubmit={search}>
        <fieldset disabled={editor.saving} className="min-w-0 border-0 p-0">
          <SearchBox size="lg">
            <SearchBoxFields className="min-w-0">
              <SearchBoxSelect
                label="検索先"
                value={sourceName}
                onChange={(event) => {
                  request.current?.abort()
                  setFailedDetail(undefined)
                  setMessage('')
                  setPending(false)
                  const next = sources.find(
                    (item) => item.name === event.target.value,
                  )
                  setSourceName(event.target.value)
                  setField(
                    next?.queryFields.includes('isbn')
                      ? 'isbn'
                      : (next?.queryFields[0] ?? ''),
                  )
                }}
              >
                {sources.length === 0 && (
                  <option value="">選択してください</option>
                )}
                {sources.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.label}
                  </option>
                ))}
              </SearchBoxSelect>
              <SearchBoxSelect
                label="検索キー"
                value={field}
                onChange={(event) => {
                  request.current?.abort()
                  setFailedDetail(undefined)
                  setMessage('')
                  setPending(false)
                  setField(event.target.value)
                }}
              >
                {(source?.queryFields ?? []).map((item) => (
                  <option key={item} value={item}>
                    {fieldLabels[item] ?? item}
                  </option>
                ))}
              </SearchBoxSelect>
              <SearchBoxInput
                autoFocus
                label="検索"
                name="q"
                type="search"
                value={query}
                onCompositionStart={() => {
                  composing.current = true
                }}
                onCompositionEnd={() => {
                  composing.current = false
                }}
                onChange={(event) => {
                  request.current?.abort()
                  setFailedDetail(undefined)
                  setMessage('')
                  setPending(false)
                  setQuery(event.target.value)
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
        {failedDetail && !dialogOpen && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => applyBook(failedDetail, true)}
          >
            検索結果の情報を使用
          </Button>
        )}
        {message && (
          <p role="status" className="mt-2 text-solid-gray-700">
            {message}
          </p>
        )}
      </form>
      <SelectionDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            request.current?.abort()
            setPending(false)
          }
          setDialogOpen(open)
        }}
        title="書誌情報を選択"
        options={results.map((item, index) => ({
          value: String(index),
          label: [
            item.data.title || 'タイトルなし',
            item.data.volume,
            item.data.authorSummary,
            item.data.publisherSummary,
            item.data.firstPublishDate,
          ]
            .filter(Boolean)
            .join(' / '),
        }))}
        onSelect={(value) => {
          const item = results[Number(value)]
          if (item) void selectBook(item)
        }}
        error={dialogError}
        busy={pending}
        footer={
          <div className="flex flex-col gap-3">
            {failedDetail && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => applyBook(failedDetail, true)}
              >
                {failedDetail.data.title || '選択した書誌'}の検索結果を使用
              </Button>
            )}
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || resultPage === 1}
                onClick={() => void changePage(resultPage - 1)}
              >
                前へ
              </Button>
              <span>{resultPage} ページ</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || results.length < 20}
                onClick={() => void changePage(resultPage + 1)}
              >
                次へ
              </Button>
            </div>
          </div>
        }
      />
      <div className="min-h-0 flex-1">
        <BookInformationLayout
          key={editor.revision}
          value={editor.draft}
          onChange={editor.change}
          onBeginAuthorityEdit={editor.cancelLookup}
          busy={editor.saving}
        />
      </div>
      <div className="shrink-0 border-t border-solid-gray-300 bg-white px-4 py-3">
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
            disabled={editor.saving}
            onClick={clearForm}
          >
            入力をクリア
          </Button>
          <Button
            type="button"
            size="md"
            variant="outline"
            disabled={pending || editor.saving || editor.resolving}
            onClick={() => void save(false)}
          >
            {editor.saving ? '保存中…' : '保存'}
          </Button>
          <Button
            type="button"
            size="md"
            variant="solid-fill"
            disabled={pending || editor.saving || editor.resolving}
            onClick={() => void save(true)}
          >
            保存して作成
          </Button>
        </div>
      </div>
    </div>
  )
}
