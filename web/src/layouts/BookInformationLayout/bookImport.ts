import { authorityName } from '../../components/AuthorityDialog/names.ts'
import type { ExternalBook } from '../../api/externalBooks.ts'
import {
  newAuthority,
  type Authority,
} from '../../components/AuthorityDialog/authority.ts'

export function importedAuthors(book: ExternalBook): Authority[] {
  if (book.data.authors?.length)
    return book.data.authors.map((item) => {
      const author = newAuthority('author')
      author.title = authorityName(item.title)
      author.transcription = authorityName(item.transcription ?? '')
      author.role = item.role || '著'
      author.references = Object.entries(item.references ?? {}).map(
        ([key, value]) => ({ key, value, rowId: `${author.rowId}-${key}` }),
      )
      return author
    })
  const fields =
    book.record.fields?.creator?.map((item) => item.value).filter(Boolean) ?? []
  const creators = fields.length
    ? fields
    : (book.data.authorSummary?.split(/\s*;\s*/).filter(Boolean) ?? [])
  return creators.flatMap((creator) => {
    const match = creator
      .trim()
      .match(
        /^(.*?)(?:(?:\s*\[|\s*［)(著|編|訳|監修|作|画|絵)(?:\]|］)|\s+(著|編|訳|監修|作|画|絵))?$/,
      )
    const name = match?.[1]?.trim()
    if (!name) return []
    const author = newAuthority('author')
    author.title = authorityName(name)
    author.role = match?.[2] ?? match?.[3] ?? '著'
    return [author]
  })
}
