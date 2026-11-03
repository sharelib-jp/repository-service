import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../atoms/Button'
import { Checkbox } from '../../atoms/Checkbox'
import { updateUser, type RoleSetting, type UserSetting } from '../../api/users'
import { SettingsDialog, fieldClass } from './SettingsDialog'

export function UserEditor({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user: UserSetting
  roles: RoleSetting[]
  onClose: () => void
  onSaved: () => void
}) {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [status, setStatus] = useState(user.status)
  const [selected, setSelected] = useState(user.roles)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await updateUser(user, { displayName, status, roles: selected })
      onSaved()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '保存できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsDialog title="ユーザー設定を編集" busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5" aria-busy={busy}>
        <p className="break-all text-sm text-solid-gray-700">
          ユーザー ID: {user.id}
        </p>
        <label className="flex flex-col gap-2 font-bold">
          表示名
          <input
            className={fieldClass}
            value={displayName}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-2 font-bold">
          状態
          <select
            className={fieldClass}
            value={status}
            disabled={busy}
            onChange={(event) =>
              setStatus(event.target.value as UserSetting['status'])
            }
          >
            <option value="active">有効</option>
            <option value="suspended">停止</option>
          </select>
        </label>
        <fieldset disabled={busy}>
          <legend className="mb-2 font-bold">所属ロール</legend>
          {roles.map((role) => (
            <Checkbox
              key={role.id}
              size="md"
              checked={selected.includes(role.id)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, role.id]
                    : current.filter((id) => id !== role.id),
                )
              }
            >
              {role.name}（{role.id}）
            </Checkbox>
          ))}
          <p className="mt-2 text-sm text-solid-gray-700">
            このアプリケーションの操作には管理者（admin）ロールが必要です。
          </p>
        </fieldset>
        <dl className="text-sm text-solid-gray-700">
          <dt className="font-bold">認証元</dt>
          <dd className="break-all">{user.authIssuer}</dd>
          <dt className="mt-2 font-bold">認証元のユーザー ID</dt>
          <dd className="break-all">{user.authSubject}</dd>
        </dl>
        {error && (
          <p role="alert" className="text-error-1">
            {error}
          </p>
        )}
        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-solid-gray-300 bg-white pt-4">
          <Button
            type="button"
            size="md"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            キャンセル
          </Button>
          <Button type="submit" size="md" variant="solid-fill" disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </div>
      </form>
    </SettingsDialog>
  )
}
