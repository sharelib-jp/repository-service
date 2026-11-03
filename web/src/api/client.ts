export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let getAccessToken:
  (() => string | Promise<string | undefined> | undefined) | undefined
/** Supply the token from the authentication layer; tokens are not persisted here. */
export function setAccessTokenProvider(provider: typeof getAccessToken) {
  getAccessToken = provider
}

let csrfToken: string | undefined
export function setCSRFToken(value: string | undefined) {
  csrfToken = value
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken?.()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (
    !token &&
    csrfToken &&
    !['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase())
  ) {
    headers.set('X-CSRF-Token', csrfToken)
  }
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const error = new ApiError(
      response.status,
      body?.error?.code ?? 'request_failed',
      body?.error?.message ?? '処理を完了できませんでした。',
    )
    if (typeof window !== 'undefined' && [401, 403].includes(error.status)) {
      window.dispatchEvent(
        new CustomEvent('repository-auth-error', { detail: error.status }),
      )
    }
    throw error
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export type ApiPage<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
