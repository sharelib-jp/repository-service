import { createFileRoute } from '@tanstack/react-router'
import { BookListPage } from '../../components/BookList/BookListPage'

type BookListUrlSearch = { authorId?: string; authorName?: string }

export const Route = createFileRoute('/books/')({
  component: ListPage,
  validateSearch: (search: Record<string, unknown>): BookListUrlSearch => ({
    authorId: typeof search.authorId === 'string' ? search.authorId.trim() : '',
    authorName:
      typeof search.authorName === 'string' ? search.authorName.trim() : '',
  }),
})

function ListPage() {
  const { authorId, authorName } = Route.useSearch()
  return <BookListPage authorId={authorId} authorName={authorName} />
}
