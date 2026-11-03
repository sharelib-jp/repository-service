import { createFileRoute } from '@tanstack/react-router'
import { BookEditPage } from '../../layouts/BookInformationLayout/BookEditPage'

export const Route = createFileRoute('/books/edit/')({
  component: EmptyBookEditRoute,
})

function EmptyBookEditRoute() {
  return <BookEditPage bookId="" />
}
