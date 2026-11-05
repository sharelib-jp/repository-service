import { ApiError, apiRequest, type ApiPage } from './client.ts'
import type { BookHistoryEntry } from '../components/BookHistory/bookHistory.ts'

type ChangeData = Omit<BookHistoryEntry, 'bookId'>

export async function loadBookHistory(
  bookId: string,
  signal: AbortSignal,
): Promise<BookHistoryEntry[]> {
  const id = bookId.trim()
  const byCode = `/api/copies/lookup/history?${new URLSearchParams({ code: id })}`
  let base = byCode
  if (/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(id)) {
    base = `/api/copies/${encodeURIComponent(id.toUpperCase())}/history?`
  }
  const getPage = (path: string, page: number) =>
    apiRequest<ApiPage<ChangeData>>(
      `${path}${path.endsWith('?') ? '' : '&'}page=${page}&pageSize=100`,
      { signal },
    )
  let result: ApiPage<ChangeData>
  try {
    result = await getPage(base, 1)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404 || base === byCode)
      throw error
    base = byCode
    result = await getPage(base, 1)
  }
  const entries = [...result.items]
  const pages = Math.ceil(result.total / result.pageSize)
  for (let page = 2; page <= pages; page++) {
    const next = await getPage(base, page)
    entries.push(...next.items)
  }
  // Concurrent writes can move records between pages. Deduplicate by history ID.
  return [
    ...new Map(
      entries.map((entry) => [entry.id, { ...entry, bookId: id }]),
    ).values(),
  ]
}
