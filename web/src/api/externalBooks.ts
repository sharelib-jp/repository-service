import { apiRequest } from './client.ts'

export type ExternalBook = {
  source: string
  detailId?: string
  data: {
    title?: string
    titleTranscription?: string
    authorSummary?: string
    publisherSummary?: string
    publisherSummaryTranscription?: string
    firstPublishDate?: string
    ndc?: string
    ndcEdition?: string
    language?: string
    volume?: string
    authors?: Array<{
      title: string
      transcription?: string
      role?: string
      references?: Record<string, string>
    }>
    reference?: Record<string, unknown>
  }
  record: {
    source: { record_id?: string }
    fields?: Record<string, Array<{ value: string }>>
  }
}

export async function searchExternalBooks(
  source: string,
  field: string,
  query: string,
  page: number,
  signal: AbortSignal,
): Promise<ExternalBook[]> {
  const params = new URLSearchParams({
    source,
    [`q[${field}]`]: query,
    page: String(page),
    pageSize: '20',
  })
  const result = await apiRequest<{ items: ExternalBook[] }>(
    `/api/external/books?${params}`,
    { signal },
  )
  return result.items
}

export async function externalBookDetails(
  source: string,
  id: string,
  signal: AbortSignal,
): Promise<ExternalBook> {
  return apiRequest<ExternalBook>(
    `/api/external/books/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
    { signal },
  )
}
