import { createFileRoute } from '@tanstack/react-router'
import { AuthorListPage } from '../../components/AuthorList/AuthorListPage'

export const Route = createFileRoute('/authors/')({
  component: AuthorListPage,
})
