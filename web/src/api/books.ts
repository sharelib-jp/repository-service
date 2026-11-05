import { apiRequest } from './client.ts'
import type { AuthorityData } from './authorities.ts'

export type CopyData = {
  id?: string
  bookId?: string
  managementCode: string
  deliveredAt?: string | null
  condition: string
  loanPolicy: string
  version?: number
  updatedAt?: string
}

export type BookData = {
  id?: string
  version?: number
  title: string
  titleTranscription?: string
  volume?: string
  authorSummary?: string
  authorSummaryTranscription?: string
  publisherId?: string | null
  publisherSummary?: string
  publisherSummaryTranscription?: string
  firstPublishDate?: string | null
  firstPublishDatePrecision?: string | null
  ndc?: string
  ndcEdition?: string
  language?: string
  authors?: Array<{
    authorityId?: string
    role: string
    position?: number
    authority?: AuthorityData
  }>
  publisher?: AuthorityData | null
  reference?: Record<string, unknown>
  otherAttributes?: Record<string, unknown>
  copies?: CopyData[]
  deletedCopies?: Array<{ id: string; version: number }>
  createdAt?: string
  updatedAt?: string
  createdBy?: string | null
  updatedBy?: string | null
}

export const getBook = (id: string, signal?: AbortSignal) =>
  apiRequest<BookData>(`/api/books/${encodeURIComponent(id)}`, { signal })
export const saveBook = (data: BookData, id?: string) =>
  apiRequest<BookData>(
    id ? `/api/books/${encodeURIComponent(id)}` : '/api/books',
    { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) },
  )
export const deleteBook = (id: string, version: number) =>
  apiRequest<void>(
    `/api/books/${encodeURIComponent(id)}?${new URLSearchParams({ version: String(version) })}`,
    { method: 'DELETE' },
  )

export async function lookupBookId(value: string): Promise<string | null> {
  const code = value.trim()
  if (/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(code)) {
    try {
      const copy = await apiRequest<CopyData>(
        `/api/copies/${encodeURIComponent(code.toUpperCase())}`,
      )
      return copy.bookId ?? null
    } catch (error) {
      if (!(
        error instanceof Error &&
        'status' in error &&
        error.status === 404
      ))
        throw error
    }
  }
  try {
    const copy = await apiRequest<CopyData>(
      `/api/copies/lookup?${new URLSearchParams({ code })}`,
    )
    return copy.bookId ?? null
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404)
      return null
    throw error
  }
}
