import {
  authorityName,
  wikidataNameQuery,
} from '../components/AuthorityDialog/names.ts'
import { apiRequest, type ApiPage } from './client.ts'
import {
  draftId,
  newAuthority,
  type Authority,
  type AuthorityCandidate,
  type AuthorityKind,
} from '../components/AuthorityDialog/authority.ts'

export type AuthorityData = {
  id?: string
  title?: string
  transcription?: string
  language?: string
  type?: Authority['type']
  alternativeTitles?: {
    title: string
    transcription: string
    language: string
  }[]
  birthDate?: Authority['birthDate']
  birthDatePrecision?: Authority['birthDatePrecision']
  foundationDate?: Authority['foundationDate']
  foundationDatePrecision?: Authority['foundationDatePrecision']
  references?: Record<string, unknown>
  updatedAt?: string
  createdAt?: string
  description?: string
}
export type ExternalSource = {
  name: string
  label: string
  resource: 'books' | 'authorities'
  queryFields: string[]
  supportsDetails?: boolean
}
export type ExternalResult = {
  source: string
  mappingVersion: string
  record: { source: { record_id?: string }; warnings?: unknown[] }
  data: AuthorityData
}

export function authorityFromData(
  data: AuthorityData,
  kind: AuthorityKind,
  existing = false,
): Authority {
  const result = newAuthority(kind)
  result.id = existing ? (data.id ?? '') : ''
  result.title =
    kind === 'author' ? authorityName(data.title ?? '') : (data.title ?? '')
  result.transcription =
    kind === 'author'
      ? authorityName(data.transcription ?? '')
      : (data.transcription ?? '')
  result.language = data.language ?? ''
  result.type = ['Person', 'Organization', 'Other'].includes(data.type ?? '')
    ? data.type!
    : 'Other'
  result.alternativeTitles = (data.alternativeTitles ?? []).map((title) => ({
    ...title,
    rowId: draftId(),
  }))
  result.birthDate = data.birthDate ?? ''
  result.birthDatePrecision = data.birthDatePrecision ?? ''
  result.foundationDate = data.foundationDate ?? ''
  result.foundationDatePrecision = data.foundationDatePrecision ?? ''
  result.references = Object.entries(data.references ?? {}).map(
    ([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      rowId: draftId(),
      jsonValue: typeof value !== 'string',
    }),
  )
  result.updatedAt = data.updatedAt
  result.createdAt = data.createdAt
  return result
}
export function authorityToData(authority: Authority): AuthorityData {
  return {
    id: authority.id || undefined,
    title: authority.title,
    transcription: authority.transcription,
    language: authority.language,
    type: authority.type,
    alternativeTitles: authority.alternativeTitles.map(
      ({ title, transcription, language }) => ({
        title,
        transcription,
        language,
      }),
    ),
    birthDate: authority.birthDate,
    birthDatePrecision: authority.birthDatePrecision,
    foundationDate: authority.foundationDate,
    foundationDatePrecision: authority.foundationDatePrecision,
    references: Object.fromEntries(
      authority.references.map(({ key, value, jsonValue }) => [
        key,
        jsonValue ? JSON.parse(value) : value,
      ]),
    ),
    updatedAt: authority.updatedAt,
  }
}
export async function externalSources(
  resource: ExternalSource['resource'],
  signal?: AbortSignal,
): Promise<ExternalSource[]> {
  const result = await apiRequest<{ items: ExternalSource[] }>(
    `/api/external/sources?resource=${resource}`,
    { signal },
  )
  return result.items
}
export async function searchExternalAuthorities(
  source: ExternalSource,
  query: string,
  kind: AuthorityKind,
  signal: AbortSignal,
): Promise<AuthorityCandidate[]> {
  const field = source.queryFields.includes('keyword')
    ? 'keyword'
    : source.queryFields.includes('title')
      ? 'title'
      : source.queryFields[0]
  if (!field) throw new Error('このソースは検索に対応していません。')
  const params = new URLSearchParams({
    source: source.name,
    [`q[${field}]`]:
      source.name === 'wikidata' && kind === 'author'
        ? wikidataNameQuery(query)
        : query.trim(),
  })
  const result = await apiRequest<{ items: ExternalResult[] }>(
    `/api/external/authorities?${params}`,
    { signal },
  )
  return result.items.map((item, index) => ({
    source: 'external',
    sourceName: source.name,
    id: item.record.source.record_id ?? `result-${index + 1}`,
    title: item.data.title ?? '',
    description: item.data.description,
    authority: authorityFromData(item.data, kind),
  }))
}
export async function searchLibraryAuthorities(
  query: string,
  kind: AuthorityKind,
  signal: AbortSignal,
): Promise<AuthorityCandidate[]> {
  const result = await apiRequest<ApiPage<AuthorityData>>(
    `/api/authorities/${kind}?${new URLSearchParams({ q: query })}`,
    { signal },
  )
  return result.items.map((item) => ({
    source: 'library',
    id: item.id!,
    title: item.title ?? '',
    authority: authorityFromData(item, kind, true),
  }))
}
export async function saveAuthority(
  authority: Authority,
  kind: AuthorityKind,
): Promise<Authority> {
  const existing = Boolean(authority.id)
  const result = await apiRequest<AuthorityData>(
    `/api/authorities/${kind}${existing ? `/${encodeURIComponent(authority.id)}` : ''}`,
    {
      method: existing ? 'PATCH' : 'POST',
      body: JSON.stringify(authorityToData(authority)),
    },
  )
  return authorityFromData(result, kind, true)
}
