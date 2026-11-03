import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../../atoms/Button'
import { Heading, HeadingTitle } from '../../atoms/Heading'
import {
  hasAdminAccess,
  loadSession,
  loginPath,
  logout,
  type Session,
} from '../../api/session'

const SessionContext = createContext<Session | null>(null)
export const useSession = () => useContext(SessionContext)

export function Authentication({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void loadSession(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setSession(value)
          setDenied(false)
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'ログイン状態を確認できませんでした。',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [revision])

  useEffect(() => {
    const onError = (event: Event) => {
      const status = (event as CustomEvent<number>).detail
      if (status === 401) setSession({ authenticated: false })
      if (status === 403) setDenied(true)
    }
    window.addEventListener('repository-auth-error', onError)
    return () => window.removeEventListener('repository-auth-error', onError)
  }, [])

  const reload = () => setRevision((value) => value + 1)
  if (loading)
    return (
      <main className="p-6">
        <p role="status">ログイン状態を確認しています…</p>
      </main>
    )
  if (!error && session && hasAdminAccess(session) && !denied) {
    return <SessionContext value={session}>{children}</SessionContext>
  }
  const forbidden = !error && (denied || session?.authenticated)
  const returnTo =
    window.location.pathname + window.location.search + window.location.hash
  return (
    <SessionContext value={session}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-6 py-12">
        <Heading hasChip size="24">
          <HeadingTitle level="h1">
            {error
              ? 'ログイン状態を確認できません'
              : forbidden
                ? '403 — 操作権限がありません'
                : 'リポジトリにログイン'}
          </HeadingTitle>
        </Heading>
        <p>
          {error ||
            (forbidden
              ? 'このアプリケーションの利用には管理者（admin）ロールが必要です。管理者にロールの設定を依頼してください。'
              : 'auth-service のアカウントでログインしてください。')}
        </p>
        {session?.user && (
          <p className="text-solid-gray-700">
            ログイン中: {session.user.displayName || session.user.id}
          </p>
        )}
        {new URLSearchParams(window.location.search).has('authError') && (
          <p role="alert" className="text-error-1">
            アプリケーション連携が許可されませんでした。ログインをやり直してください。
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {!error && !session?.authenticated && (
            <Button asChild size="md" variant="solid-fill">
              <a href={loginPath(returnTo)}>auth-service でログイン</a>
            </Button>
          )}
          <Button type="button" size="md" variant="outline" onClick={reload}>
            再読み込み
          </Button>
          {session?.authenticated && <LogoutButton />}
        </div>
      </main>
    </SessionContext>
  )
}

export function LogoutButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function signOut() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await logout()
      window.location.assign('/')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'ログアウトできませんでした。',
      )
      setBusy(false)
    }
  }
  return (
    <div>
      <Button
        type="button"
        size="md"
        variant="outline"
        disabled={busy}
        onClick={() => void signOut()}
      >
        {busy ? 'ログアウト中…' : 'ログアウト'}
      </Button>
      {error && (
        <p role="alert" className="text-error-1">
          {error}
        </p>
      )}
    </div>
  )
}
