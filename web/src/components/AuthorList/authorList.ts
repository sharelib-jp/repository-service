import type { Authority } from '../AuthorityDialog'

export type AuthorListItem = Authority & { updatedAt?: string }

export function filterAuthors(
  authors: readonly AuthorListItem[],
  keyword: string,
): AuthorListItem[] {
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
