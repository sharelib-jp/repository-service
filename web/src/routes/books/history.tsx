import { loadBookHistory } from '../../api/bookHistory'
import { createFileRoute } from '@tanstack/react-router'
import { BookHistoryPage } from '../../components/BookHistory/BookHistoryPage'

type HistorySearch = { bookId?: string }

export const Route = createFileRoute('/books/history')({
  validateSearch: (search: Record<string, unknown>): HistorySearch => ({
    bookId: typeof search.bookId === 'string' ? search.bookId.trim() : '',
  }),
  component: HistoryRoute,
})

function HistoryRoute() {
  const { bookId = '' } = Route.useSearch()
  return (
    <BookHistoryPage
      key={bookId}
      initialBookId={bookId}
      loadHistory={loadBookHistory}
    />
  )
}
