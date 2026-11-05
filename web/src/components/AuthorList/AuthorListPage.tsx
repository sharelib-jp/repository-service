import { AuthorityListPage } from '../AuthorityList/AuthorityListPage'
import type { AuthorListItem } from './authorList'

export function AuthorListPage({
  authors,
  onAuthorChange,
}: {
  authors?: readonly AuthorListItem[]
  onAuthorChange?: (author: AuthorListItem) => void | Promise<void>
}) {
  return (
    <AuthorityListPage
      kind="author"
      authorities={authors}
      onAuthorityChange={onAuthorChange}
    />
  )
}
