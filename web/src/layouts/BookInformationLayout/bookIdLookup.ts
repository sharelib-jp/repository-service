export type BookIdInputKind = 'bibliographic' | 'copy'
export type LookupBookId = (copyId: string) => Promise<string | null>

export type BookIdResolution =
  | { status: 'resolved'; bookId: string }
  | { status: 'empty' | 'invalid-id' | 'not-found' | 'unavailable' }

export function isBookInformationId(value: string): boolean {
  return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(value)
}

/** The lookup function can be supplied when the book-copy API is available. */
export async function resolveBookInformationId(
  kind: BookIdInputKind,
  input: string,
  lookupBookId?: LookupBookId,
): Promise<BookIdResolution> {
  const value = input.trim()
  if (!value) return { status: 'empty' }
  if (kind === 'bibliographic') {
    return isBookInformationId(value)
      ? { status: 'resolved', bookId: value.toUpperCase() }
      : { status: 'invalid-id' }
  }
  if (!lookupBookId) return { status: 'unavailable' }
  const bookId = await lookupBookId(value)
  if (!bookId) return { status: 'not-found' }
  const normalizedId = bookId.trim()
  return isBookInformationId(normalizedId)
    ? { status: 'resolved', bookId: normalizedId.toUpperCase() }
    : { status: 'invalid-id' }
}
