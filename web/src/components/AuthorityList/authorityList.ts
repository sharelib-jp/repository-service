import type { Authority } from '../AuthorityDialog/authority.ts'

export type AuthorityListItem = Authority & { updatedAt?: string }

export function filterAuthorities(
  authors: readonly AuthorityListItem[],
  keyword: string,
): AuthorityListItem[] {
  const query = keyword.trim().normalize('NFKC').toLocaleLowerCase()
  if (!query) return [...authors]
  return authors.filter((author) =>
    [
      author.id,
      author.title,
      author.transcription,
      ...author.alternativeTitles.flatMap((title) => [
        title.title,
        title.transcription,
      ]),
      ...author.references.flatMap((reference) => [
        reference.key,
        reference.value,
      ]),
    ].some((value) =>
      value.normalize('NFKC').toLocaleLowerCase().includes(query),
    ),
  )
}
