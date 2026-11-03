import { createFileRoute } from '@tanstack/react-router'
import { BookEditPage } from '../../layouts/BookInformationLayout/BookEditPage'

export const Route = createFileRoute('/books/edit/$bookId')({
  component: EditBookRoute,
})

function EditBookRoute() {
  const { bookId } = Route.useParams()
  return <BookEditPage key={bookId} bookId={bookId} />
}
