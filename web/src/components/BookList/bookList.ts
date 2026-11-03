export type BookListItem = {
  bookId: string
  title: string
  author: string
  publisher: string
  updatedAt: string
  status: string
  loanLabel: string
  hasLoanHistory: boolean
  /** ID used by the bibliographic information edit route. */
  bibliographicId: string
  /** IDs of the author authorities linked to the bibliographic record. */
  authorIds: readonly string[]
}

export type BookListSearch = {
  keyword: string
  status: string
  loanHistory: string
  authorId?: string
}

export function filterBooks(
  books: readonly BookListItem[],
  search: BookListSearch,
) {
  const keyword = search.keyword.trim().toLocaleLowerCase()
  return books.filter(
    (book) =>
      (!keyword ||
        [book.bookId, book.title, book.author, book.publisher].some((value) =>
          value.toLocaleLowerCase().includes(keyword),
        )) &&
      (!search.status || book.status === search.status) &&
      (!search.authorId || book.authorIds?.includes(search.authorId)) &&
      (!search.loanHistory ||
        book.hasLoanHistory === (search.loanHistory === 'yes')),
  )
}
