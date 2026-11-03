import { apiRequest, type ApiPage } from './client.ts'

export type UserSetting = {
  id: string
  displayName: string
  status: 'active' | 'suspended'
  roles: string[]
  authIssuer: string
  authSubject: string
  createdAt: string
  updatedAt: string
}
export type RoleSetting = {
  id: string
  name: string
  userCount: number
  system: boolean
}
export type SessionUser =
  { id: string; roles: string[] } | { authenticated: false; development: true }

export const currentUser = (signal?: AbortSignal) =>
  apiRequest<SessionUser>('/api/me', { signal })

export function canManageUsers(user: SessionUser): boolean {
  return 'development' in user ? user.development : user.roles.includes('admin')
}
export function listUsers(
  query: string,
  status: string,
  page: number,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    q: query,
    status,
    page: String(page),
    pageSize: '20',
  })
  return apiRequest<ApiPage<UserSetting>>(`/api/users?${params}`, { signal })
}
export async function listRoles(signal?: AbortSignal) {
  const result = await apiRequest<{ items: RoleSetting[] }>('/api/roles', {
    signal,
  })
  return result.items
}
export function updateUser(
  user: UserSetting,
  fields: Pick<UserSetting, 'displayName' | 'status' | 'roles'>,
) {
  return apiRequest<UserSetting>(`/api/users/${encodeURIComponent(user.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...fields, updatedAt: user.updatedAt }),
  })
}
export function saveRole(id: string, name: string, existing?: RoleSetting) {
  return apiRequest<{ id: string; name: string }>(
    existing ? `/api/roles/${encodeURIComponent(existing.id)}` : '/api/roles',
    {
      method: existing ? 'PATCH' : 'POST',
      body: JSON.stringify(
        existing ? { name, previousName: existing.name } : { id, name },
      ),
    },
  )
}
export function deleteRole(role: RoleSetting) {
  return apiRequest<void>(
    `/api/roles/${encodeURIComponent(role.id)}?${new URLSearchParams({ name: role.name })}`,
    { method: 'DELETE' },
  )
}
