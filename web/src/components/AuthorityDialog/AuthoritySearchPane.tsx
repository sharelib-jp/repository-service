import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Button } from '../../atoms/Button'
import { Heading, HeadingTitle } from '../../atoms/Heading'
import { Input } from '../../atoms/Input'
import type {
  AuthorityCandidate,
  AuthorityKind,
  AuthoritySearch,
} from './authority'

type Props = {
  title: string
  kind: AuthorityKind
  search?: AuthoritySearch
  onAdd: (candidate: AuthorityCandidate) => void
  sourceControl?: ReactNode
  unavailableMessage?: string
}

export function AuthoritySearchPane({
  title,
  kind,
  search,
  onAdd,
  sourceControl,
  unavailableMessage = '館内典拠の検索は準備中です。',
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AuthorityCandidate[]>([])
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => request.current?.abort(), [])

  function resetRequest() {
    request.current?.abort()
    request.current = null
    setPending(false)
    setResults([])
    setMessage('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const term = query.trim()
    resetRequest()
    if (!term) {
      setMessage('検索語を入力してください。')
      return
    }
    if (!search) {
      setMessage(unavailableMessage)
      return
    }
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    try {
      const found = await search(term, kind, controller.signal)
      if (controller.signal.aborted) return
      setResults(found)
      setMessage(found.length ? '' : '一致する典拠が見つかりませんでした。')
    } catch {
      if (!controller.signal.aborted)
        setMessage('検索できませんでした。時間をおいて再度お試しください。')
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return (
    <section className="flex min-h-64 min-w-0 flex-col gap-3 rounded-8 border border-solid-gray-300 p-3 lg:min-h-0">
      <Heading size="18" hasChip={false}>
        <HeadingTitle level="h3">{title}</HeadingTitle>
      </Heading>
      {sourceControl}
      <form onSubmit={submit} className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{title}の検索語</span>
          <Input
            blockSize="md"
            className="w-full"
            value={query}
            onChange={(event) => {
              resetRequest()
              setQuery(event.target.value)
            }}
          />
        </label>
        <Button type="submit" size="md" variant="outline" disabled={pending}>
          検索
        </Button>
      </form>
      {message && (
        <p role="status" className="text-solid-gray-700">
          {message}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-96 border-collapse text-dns-16N-130">
          <caption className="sr-only">{title}の検索結果</caption>
          <thead>
            <tr className="border-b border-black bg-solid-gray-100">
              <th scope="col" className="p-2 text-left">
                ID
              </th>
              <th scope="col" className="p-2 text-left">
                タイトル・説明
              </th>
              <th scope="col" className="p-2">
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr
                key={`${result.sourceName ?? result.source}-${result.id}`}
                className="border-b border-solid-gray-300"
              >
                <td className="p-2 align-top">{result.id}</td>
                <td className="p-2 align-top">
                  {result.title}
                  {result.description && (
                    <p className="text-solid-gray-700">{result.description}</p>
                  )}
                </td>
                <td className="p-2 align-top">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`${result.title}を追加`}
                    onClick={() => onAdd(result)}
                  >
                    追加
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
