import { apiRequest } from './client.ts'
import {
  authorityFromData,
  externalSources,
  searchExternalAuthorities,
  type AuthorityData,
} from './authorities.ts'
import {
  authorityFromCandidate,
  type Authority,
  type AuthorityKind,
} from '../components/AuthorityDialog/authority.ts'

export function wikidataID(authority: Authority): string {
  const value =
    authority.references.find(
      (ref) => ref.key.toLowerCase() === 'wikidata' && !ref.jsonValue,
    )?.value ?? ''
  return /^Q[1-9][0-9]*$/.test(value) ? value : ''
}

export async function reuseLibraryAuthority(
  authority: Authority,
  kind: AuthorityKind,
  signal?: AbortSignal,
): Promise<Authority> {
  if (authority.id) return authority
  const title = authority.title.trim()
  const qid = wikidataID(authority)
  if (!title && !qid) return authority
  const params = new URLSearchParams({ title, wikidata: qid })
  const result = await apiRequest<{ item: AuthorityData | null }>(
    `/api/authorities/${kind}/match?${params}`,
    { signal },
  )
  if (!result.item) return authority
  // The relationship's role/order belong to the book. All authority content is local.
  return {
    ...authorityFromData(result.item, kind, true),
    rowId: authority.rowId,
    role: authority.role,
  }
}

export async function resolveBookAuthorities(
  authors: Authority[],
  publishers: Authority[],
  signal: AbortSignal,
) {
  let sourceRequest: ReturnType<typeof externalSources> | undefined
  const issues: string[] = []
  const resolveAuthority = async (
    row: Authority,
    kind: AuthorityKind,
  ): Promise<Authority> => {
    const local = await reuseLibraryAuthority(row, kind, signal)
    if (local.id || wikidataID(row)) return local
    sourceRequest ??= externalSources('authorities', signal)
    const source = (await sourceRequest).find(
      (item) => item.name === 'wikidata',
    )
    if (!source) throw new Error('Wikidata の検索ソースがありません。')
    const candidates = await searchExternalAuthorities(
      source,
      row.title,
      kind,
      signal,
    )
    if (!candidates[0])
      throw new Error(
        `「${row.title}」の${kind === 'author' ? '著者' : '出版社'}典拠が見つかりませんでした。`,
      )
    const external = authorityFromCandidate(candidates[0], kind)
    const next = {
      ...external,
      rowId: row.rowId,
      title: row.title,
      transcription: row.transcription || external.transcription,
      role: row.role,
      references: [
        ...row.references,
        ...external.references.filter(
          (ref) => !row.references.some((item) => item.key === ref.key),
        ),
      ],
    }
    return reuseLibraryAuthority(next, kind, signal)
  }
  const safely = async (
    row: Authority,
    resolve: (row: Authority) => Promise<Authority>,
  ) => {
    try {
      return await resolve(row)
    } catch (cause) {
      issues.push(
        cause instanceof Error
          ? cause.message
          : '館内典拠を照合できませんでした。',
      )
      return row
    }
  }
  const [resolvedAuthors, resolvedPublishers] = await Promise.all([
    Promise.all(
      authors.map((row) =>
        safely(row, (draft) => resolveAuthority(draft, 'author')),
      ),
    ),
    Promise.all(
      publishers.map((row) =>
        safely(row, (draft) => resolveAuthority(draft, 'publisher')),
      ),
    ),
  ])
  return { authors: resolvedAuthors, publishers: resolvedPublishers, issues }
}
