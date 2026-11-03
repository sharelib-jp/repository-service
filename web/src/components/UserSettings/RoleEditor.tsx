import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../atoms/Button'
import { deleteRole, saveRole, type RoleSetting } from '../../api/users'
import { SettingsDialog, fieldClass } from './SettingsDialog'

export function RoleEditor({
  role,
  onClose,
  onSaved,
}: {
  role?: RoleSetting
  onClose: () => void
  onSaved: () => void
}) {
  const [id, setId] = useState(role?.id ?? '')
  const [name, setName] = useState(role?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await saveRole(id, name, role)
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
    <SettingsDialog
      title={role ? 'ロールを編集' : 'ロールを追加'}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-5" aria-busy={busy}>
        <label className="flex flex-col gap-2 font-bold">
          ロール ID
          <input
            className={fieldClass}
            value={id}
            required
            maxLength={64}
            pattern={'[a-z][a-z0-9_\\-]{0,63}'}
            readOnly={Boolean(role)}
            disabled={busy}
            autoComplete="off"
            onChange={(event) => setId(event.target.value)}
            aria-describedby="role-id-description"
          />
        </label>
        <p id="role-id-description" className="text-sm text-solid-gray-700">
          英小文字から始まる英小文字・数字・ハイフン・アンダースコア。作成後は変更できません。
        </p>
        <label className="flex flex-col gap-2 font-bold">
          表示名
          <input
            className={fieldClass}
            value={name}
            required
            maxLength={100}
            disabled={busy}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="text-sm text-solid-gray-700">
          追加したロールは利用者の分類に使えます。現在、操作権限を持つロール ID
          は admin です。
        </p>
        {error && (
          <p role="alert" className="text-error-1">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3 border-t border-solid-gray-300 pt-4">
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

export function DeleteRoleDialog({
  role,
  onClose,
  onDeleted,
}: {
  role: RoleSetting
  onClose: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function remove() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await deleteRole(role)
      onDeleted()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '削除できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsDialog title="ロールを削除" busy={busy} onClose={onClose}>
      <p className="my-4">
        「{role.name}（{role.id}）」を削除します。
      </p>
      {error && (
        <p role="alert" className="mb-4 text-error-1">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          size="md"
          variant="outline"
          disabled={busy}
          onClick={onClose}
        >
          キャンセル
        </Button>
        <Button
          type="button"
          size="md"
          variant="outline"
          disabled={busy}
          onClick={() => void remove()}
        >
          {busy ? '削除中…' : '削除する'}
        </Button>
      </div>
    </SettingsDialog>
  )
}
