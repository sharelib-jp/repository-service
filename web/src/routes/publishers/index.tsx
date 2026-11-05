import { createFileRoute } from '@tanstack/react-router'
import { PublisherListPage } from '../../components/PublisherList/PublisherListPage'

export const Route = createFileRoute('/publishers/')({
  component: PublisherListPage,
})
