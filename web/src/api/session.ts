import { apiRequest, setCSRFToken } from './client.ts'

export type Session = {
  authenticated: boolean
  development?: boolean
  loginURL?: string
  csrfToken?: string
  user?: {
    id: string
    displayName: string
    status: 'active' | 'suspended'
    roles: string[]
  }
}
export async function loadSession(signal?: AbortSignal): Promise<Session> {
  const session = await apiRequest<Session>('/api/auth/session', { signal })
  setCSRFToken(session.csrfToken)
  return session
}
export function hasAdminAccess(session: Session): boolean {
  return (
    session.development === true ||
    (session.authenticated &&
      session.user?.status === 'active' &&
      session.user.roles.includes('admin')) === true
  )
}
export async function logout() {
  await apiRequest<void>('/api/auth/logout', { method: 'POST' })
  setCSRFToken(undefined)
}
export function loginPath(returnTo: string): string {
  return `/api/auth/login?${new URLSearchParams({ returnTo })}`
}
