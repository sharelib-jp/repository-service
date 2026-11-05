import { apiRequest, type ApiPage } from './client.ts'
import { authorityFromData, type AuthorityData } from './authorities.ts'
import type { CopyData } from './books.ts'
import type {
  BookListItem,
  BookListSearch,
} from '../components/BookList/bookList.ts'
import type { AuthorityListItem } from '../components/AuthorityList/authorityList.ts'
import type { AuthorityKind } from '../components/AuthorityDialog/authority.ts'
import {
  conditions,
  loanPolicies,
} from '../components/ShelvingList/shelving.ts'

export type CopyListData = CopyData & {
  bibliographicId: string
  title: string
  author: string
  publisher: string
  authorIds: string[]
  hasLoanHistory: boolean | null
}

export async function listCopies(
  search: BookListSearch,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<ApiPage<BookListItem>> {
  const condition =
    Object.entries(conditions).find(
      ([, label]) => label === search.status,
    )?.[0] ?? ''
  const params = new URLSearchParams({
    q: search.keyword.trim(),
    condition,
    authorId: search.authorId ?? '',
    page: String(page),
    pageSize: String(pageSize),
  })
  const result = await apiRequest<ApiPage<CopyListData>>(
    `/api/copies?${params}`,
    { signal },
  )
  return {
    ...result,
    items: result.items.map((copy) => ({
      bookId: copy.managementCode,
      bibliographicId: copy.bibliographicId,
      title: copy.title,
      author: copy.author,
      publisher: copy.publisher,
      updatedAt: copy.updatedAt ?? '',
      authorIds: copy.authorIds,
      hasLoanHistory: copy.hasLoanHistory,
      status:
        conditions[copy.condition as keyof typeof conditions] ?? copy.condition,
      loanLabel:
        loanPolicies[copy.loanPolicy as keyof typeof loanPolicies] ??
        copy.loanPolicy,
    })),
  }
}

export async function listAuthorities(
  kind: AuthorityKind,
  query: string,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<ApiPage<AuthorityListItem>> {
  const params = new URLSearchParams({
    q: query.trim(),
    page: String(page),
    pageSize: String(pageSize),
  })
  const result = await apiRequest<ApiPage<AuthorityData>>(
    `/api/authorities/${kind}?${params}`,
    { signal },
  )
  return {
    ...result,
    items: result.items.map((item) => authorityFromData(item, kind, true)),
  }
}

export const listAuthors = (
  query: string,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
) => listAuthorities('author', query, page, pageSize, signal)
