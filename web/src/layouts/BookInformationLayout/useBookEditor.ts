import { useCallback, useEffect, useRef, useState } from 'react'
import type { SetStateAction } from 'react'
import { ApiError } from '../../api/client'
import { deleteBook, getBook, saveBook, type BookData } from '../../api/books'
import { resolveBookAuthorities } from '../../api/authorityResolution'
import type { ExternalBook } from '../../api/externalBooks'
import {
  bookDataFromDraft,
  bookDraftFromData,
  importBookDraft,
  newBookDraft,
  type BookDraft,
} from './bookDraft'

export function useBookEditor(initialId = '') {
  const [draft, renderDraft] = useState<BookDraft>(newBookDraft)
  const currentDraft = useRef(draft)
  const setDraft = useCallback((update: SetStateAction<BookDraft>) => {
    const next =
      typeof update === 'function' ? update(currentDraft.current) : update
    currentDraft.current = next
    renderDraft(next)
  }, [])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [revision, setRevision] = useState(0)
  const lookup = useRef<AbortController | null>(null)
  const read = useRef<AbortController | null>(null)
  const mutation = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      read.current?.abort()
      lookup.current?.abort()
    }
  }, [])

  const cancelLookup = useCallback(() => {
    lookup.current?.abort()
    setResolving(false)
    setMessage('')
  }, [])
  const change = useCallback(
    (update: SetStateAction<BookDraft>) => {
      setDraft((current) =>
        typeof update === 'function' ? update(current) : update,
      )
      setDirty(true)
      setError('')
    },
    [setDraft],
  )
  const reset = useCallback(() => {
    read.current?.abort()
    lookup.current?.abort()
    setRevision((current) => current + 1)
    setDraft(newBookDraft())
    setError('')
    setMessage('')
    setDirty(false)
    setLoading(false)
    setResolving(false)
  }, [setDraft])
  const load = useCallback(
    async (id: string) => {
      read.current?.abort()
      lookup.current?.abort()
      const controller = new AbortController()
      read.current = controller
      setDraft((current) =>
        current.saved?.id === id ? current : newBookDraft(),
      )
      setLoading(true)
      setResolving(false)
      setError('')
      setMessage('')
      try {
        const book = await getBook(id, controller.signal)
        if (controller.signal.aborted) return false
        setRevision((current) => current + 1)
        setDraft(bookDraftFromData(book))
        setDirty(false)
        return true
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : '書誌情報を読み込めませんでした。',
          )
        return false
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [setDraft],
  )
  useEffect(() => {
    if (initialId) void load(initialId)
    return () => read.current?.abort()
  }, [initialId, load])

  async function importBook(book: ExternalBook) {
    cancelLookup()
    const controller = new AbortController()
    lookup.current = controller
    // Read the current draft after the external request finishes; late lookup results are
    // applied only while these exact author drafts are still selected.
    const initial = importBookDraft(book, currentDraft.current)
    setRevision((current) => current + 1)
    setDraft(initial)
    setDirty(true)
    setError('')
    const { authors, publishers } = initial
    if (!authors.length && !publishers.length) {
      setMessage('')
      return
    }
    setResolving(true)
    setMessage('館内典拠を照合しています。')
    try {
      const resolved = await resolveBookAuthorities(
        authors,
        publishers,
        controller.signal,
      )
      if (controller.signal.aborted) return
      setDraft((current) => ({
        ...current,
        authors:
          current.authors === authors ? resolved.authors : current.authors,
        publishers:
          current.publishers === publishers
            ? resolved.publishers
            : current.publishers,
      }))
      setMessage(
        resolved.issues.length
          ? `一部の典拠を自動取得できませんでした。典拠情報から確認してください。${resolved.issues[0]}`
          : '典拠情報を照合しました。内容を確認してください。',
      )
    } finally {
      if (!controller.signal.aborted) setResolving(false)
    }
  }

  async function save(): Promise<BookData | undefined> {
    if (mutation.current || loading || resolving) return
    const snapshot = currentDraft.current
    let payload: BookData
    try {
      payload = bookDataFromDraft(snapshot)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '入力を確認してください。',
      )
      return
    }
    mutation.current = true
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const saved = await saveBook(payload, snapshot.saved?.id)
      if (!mounted.current) return
      setRevision((current) => current + 1)
      setDraft(bookDraftFromData(saved))
      setDirty(false)
      setMessage('保存しました。')
      return saved
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : '保存できませんでした。',
        )
    } finally {
      mutation.current = false
      if (mounted.current) setSaving(false)
    }
  }
  async function remove(): Promise<boolean> {
    const saved = currentDraft.current.saved
    if (mutation.current || !saved?.id || !saved.version) return false
    mutation.current = true
    setSaving(true)
    setError('')
    try {
      await deleteBook(saved.id, saved.version)
      if (!mounted.current) return false
      reset()
      return true
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof ApiError &&
            cause.status === 422 &&
            saved.copies?.length
            ? '配架情報が残っています。配架情報を削除して保存してから、書誌情報を削除してください。'
            : cause instanceof Error
              ? cause.message
              : '削除できませんでした。',
        )
      return false
    } finally {
      mutation.current = false
      if (mounted.current) setSaving(false)
    }
  }
  return {
    revision,
    draft,
    change,
    dirty,
    loading,
    saving,
    resolving,
    message,
    error,
    reset,
    load,
    importBook,
    cancelLookup,
    save,
    remove,
  }
}
