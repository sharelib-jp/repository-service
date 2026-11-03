import { createFileRoute } from '@tanstack/react-router'
import { UserSettingsPage } from '../../components/UserSettings/UserSettingsPage'

export const Route = createFileRoute('/settings/users')({
  component: UserSettingsPage,
})
