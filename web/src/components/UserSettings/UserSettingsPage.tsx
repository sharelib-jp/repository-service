import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../atoms/Button'
import { Heading, HeadingTitle } from '../../atoms/Heading'
import {
  PageNavigation,
  PageNavigationButton,
  PageNavigationCounter,
} from '../../atoms/PageNavigation'
import {
  SearchBox,
  SearchBoxFields,
  SearchBoxInput,
} from '../../atoms/SearchBox'
import { ApiError } from '../../api/client'
import {
  canManageUsers,
  currentUser,
  listRoles,
  listUsers,
  type RoleSetting,
  type UserSetting,
} from '../../api/users'
import { EditableTable, type EditableTableColumn } from '../EditableTable'
import { UserEditor } from './UserEditor'
import { DeleteRoleDialog, RoleEditor } from './RoleEditor'
import { fieldClass } from './SettingsDialog'

const userKey = (user: UserSetting) => user.id
const roleKey = (role: RoleSetting) => role.id
function dateLabel(value: string) {
  return new Date(value).toLocaleString('ja-JP')
}

export function UserSettingsPage() {
  const [section, setSection] = useState<'users' | 'roles'>('users')
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [users, setUsers] = useState<UserSetting[]>([])
  const [roles, setRoles] = useState<RoleSetting[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [development, setDevelopment] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editingUser, setEditingUser] = useState<UserSetting | null>(null)
  const [editingRole, setEditingRole] = useState<RoleSetting | 'new' | null>(
    null,
  )
  const [deletingRole, setDeletingRole] = useState<RoleSetting | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    async function load() {
      try {
        const session = await currentUser(controller.signal)
        if (controller.signal.aborted) return
        const manage = canManageUsers(session)
        setAllowed(manage)
        setDevelopment('development' in session && session.development)
        if (!manage) {
          setUsers([])
          setRoles([])
          throw new Error('ユーザー・ロールの設定には管理者権限が必要です。')
        }
        const [userPage, roleList] = await Promise.all([
          listUsers(query, status, page, controller.signal),
          listRoles(controller.signal),
        ])
        if (controller.signal.aborted) return
        const lastPage = Math.max(1, Math.ceil(userPage.total / 20))
        if (page > lastPage) {
          setPage(lastPage)
          return
        }
        setUsers(userPage.items)
        setTotal(userPage.total)
        setRoles(roleList)
      } catch (cause) {
        if (controller.signal.aborted) return
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
          setAllowed(false)
          setUsers([])
          setRoles([])
        }
        setError(
          cause instanceof Error
            ? cause.message
            : '設定を読み込めませんでした。',
        )
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [query, status, page, revision])

  function reload(message: string) {
    setEditingUser(null)
    setEditingRole(null)
    setDeletingRole(null)
    setMessage(message)
    setRevision((value) => value + 1)
  }
  function search(event: FormEvent) {
    event.preventDefault()
    setQuery(draft)
    setPage(1)
    setRevision((value) => value + 1)
  }
  const roleNames = new Map(roles.map((role) => [role.id, role.name]))
  const userColumns: EditableTableColumn<UserSetting, string>[] = [
    {
      key: 'name',
      label: '表示名',
      getValue: (user) => user.displayName,
      renderCell: (user) => (
        <span className="font-bold">{user.displayName || '未設定'}</span>
      ),
    },
    {
      key: 'status',
      label: '状態',
      getValue: (user) => user.status,
      renderCell: (user) => (
        <span
          className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-sm ${user.status === 'active' ? 'bg-key-50 text-key-900' : 'bg-solid-gray-100 text-solid-gray-700'}`}
        >
          {user.status === 'active' ? '有効' : '停止'}
        </span>
      ),
    },
    {
      key: 'roles',
      label: '所属ロール',
      getValue: (user) => user.roles.join(', '),
      renderCell: (user) =>
        user.roles.length ? (
          <div className="flex flex-wrap gap-1">
            {user.roles.map((id) => (
              <span
                key={id}
                className="rounded-4 border border-solid-gray-300 px-2 py-1 text-sm"
              >
                {roleNames.get(id) ?? id}
              </span>
            ))}
          </div>
        ) : (
          'なし（権限なし）'
        ),
    },
    {
      key: 'identity',
      label: '認証元 / ユーザー ID',
      getValue: (user) => user.authSubject,
      renderCell: (user) => (
        <div className="max-w-72 break-all text-sm">
          <p>{user.authIssuer}</p>
          <p className="text-solid-gray-700">{user.authSubject}</p>
        </div>
      ),
    },
    {
      key: 'id',
      label: 'ローカルユーザー ID',
      getValue: (user) => user.id,
      renderCell: (user) => (
        <span className="break-all text-sm">{user.id}</span>
      ),
    },
    {
      key: 'updated',
      label: '最終更新',
      getValue: (user) => user.updatedAt,
      renderCell: (user) => (
        <span className="whitespace-nowrap text-sm">
          {dateLabel(user.updatedAt)}
        </span>
      ),
    },
    {
      key: 'edit',
      label: '操作',
      getValue: () => '',
      renderCell: (user) => (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => setEditingUser(user)}
          aria-label={`${user.displayName || user.authSubject}の設定を編集`}
        >
          編集
        </Button>
      ),
    },
  ]
  const roleColumns: EditableTableColumn<RoleSetting, string>[] = [
    {
      key: 'id',
      label: 'ロール ID',
      getValue: (role) => role.id,
      renderCell: (role) => role.id,
    },
    {
      key: 'name',
      label: '表示名',
      getValue: (role) => role.name,
      renderCell: (role) => <span className="font-bold">{role.name}</span>,
    },
    {
      key: 'count',
      label: '所属人数',
      getValue: (role) => String(role.userCount),
      renderCell: (role) => `${role.userCount} 人`,
    },
    {
      key: 'permission',
      label: '操作権限',
      getValue: () => '',
      renderCell: (role) =>
        role.id === 'admin' ? 'すべての業務操作' : '権限なし（分類用ロール）',
    },
    {
      key: 'edit',
      label: '操作',
      getValue: () => '',
      renderCell: (role) => (
        <div className="flex gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => setEditingRole(role)}
            aria-label={`${role.name}を編集`}
          >
            編集
          </Button>
          <Button
            type="button"
            size="sm"
            variant="text"
            disabled={loading || role.system || role.userCount > 0}
            onClick={() => setDeletingRole(role)}
            title={
              role.system
                ? 'システムロールは削除できません'
                : role.userCount
                  ? '所属するユーザーがいるため削除できません'
                  : undefined
            }
            aria-label={`${role.name}を削除`}
          >
            削除
          </Button>
        </div>
      ),
    },
  ]
  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <div className="flex min-h-full min-w-0 flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading hasChip size="24">
            <HeadingTitle level="h1">ユーザー・ロール設定</HeadingTitle>
          </Heading>
          <p className="mt-2 text-solid-gray-700">
            この図書館を利用するユーザーの状態と権限を管理します。
          </p>
        </div>
        <Button
          type="button"
          size="md"
          variant="outline"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          再読み込み
        </Button>
      </div>
      {development && (
        <p className="rounded-8 border border-solid-gray-300 bg-solid-gray-50 p-3 text-sm">
          認証を無効にした開発環境です。
        </p>
      )}
      {message && (
        <p role="status" className="text-key-900">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-error-1">
          {error}
        </p>
      )}
      {loading && <p role="status">読み込み中…</p>}
      {allowed && (
        <>
          <nav
            aria-label="設定の種類"
            className="flex gap-3 border-b border-solid-gray-300 pb-4"
          >
            <Button
              type="button"
              size="md"
              variant={section === 'users' ? 'solid-fill' : 'outline'}
              aria-pressed={section === 'users'}
              onClick={() => setSection('users')}
            >
              ユーザー
            </Button>
            <Button
              type="button"
              size="md"
              variant={section === 'roles' ? 'solid-fill' : 'outline'}
              aria-pressed={section === 'roles'}
              onClick={() => setSection('roles')}
            >
              ロール
            </Button>
          </nav>
          {section === 'users' ? (
            <section
              aria-label="ユーザー設定"
              className="flex min-w-0 flex-col gap-4"
              aria-busy={loading}
            >
              <Heading hasChip={false} size="20">
                <HeadingTitle level="h2">ユーザー一覧</HeadingTitle>
              </Heading>
              <form
                onSubmit={search}
                className="flex flex-wrap items-end gap-4"
              >
                <div className="min-w-60 flex-1">
                  <SearchBox size="md">
                    <SearchBoxFields className="min-w-0">
                      <SearchBoxInput
                        label="ユーザーを検索"
                        type="search"
                        value={draft}
                        className="min-w-0"
                        placeholder="表示名、ユーザー ID、認証元"
                        onChange={(event) => setDraft(event.target.value)}
                      />
                    </SearchBoxFields>
                    <Button
                      type="submit"
                      size="md"
                      variant="outline"
                      className="[grid-area:submit]"
                      disabled={loading}
                    >
                      検索
                    </Button>
                  </SearchBox>
                </div>
                <label className="flex min-w-40 flex-col gap-2">
                  状態
                  <select
                    className={fieldClass}
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value)
                      setPage(1)
                    }}
                  >
                    <option value="">すべて</option>
                    <option value="active">有効</option>
                    <option value="suspended">停止</option>
                  </select>
                </label>
              </form>
              <p className="text-sm text-solid-gray-700">
                ユーザーは初回認証時に登録されます。認証元のアカウント情報は変更しません。
              </p>
              <EditableTable
                caption="ユーザー一覧"
                rows={users}
                columns={userColumns}
                getRowKey={userKey}
                selectable={false}
                emptyMessage={
                  loading
                    ? '読み込み中です。'
                    : '条件に一致するユーザーはいません。'
                }
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p aria-live="polite">{total} 件</p>
                <PageNavigation aria-label="ユーザー一覧のページ">
                  <PageNavigationButton
                    control="prev"
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={loading || page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    前のページ
                  </PageNavigationButton>
                  <PageNavigationCounter>
                    {page} / {totalPages}
                  </PageNavigationCounter>
                  <PageNavigationButton
                    control="next"
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={loading || page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    次のページ
                  </PageNavigationButton>
                </PageNavigation>
              </div>
            </section>
          ) : (
            <section
              aria-label="ロール設定"
              className="flex min-w-0 flex-col gap-4"
              aria-busy={loading}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Heading hasChip={false} size="20">
                  <HeadingTitle level="h2">ロール一覧</HeadingTitle>
                </Heading>
                <Button
                  type="button"
                  size="md"
                  variant="outline"
                  disabled={loading}
                  onClick={() => setEditingRole('new')}
                >
                  ロールを追加
                </Button>
              </div>
              <p className="text-sm text-solid-gray-700">
                管理者・編集者ロールと、ユーザーに割り当てられているロールは削除できません。
              </p>
              <EditableTable
                caption="ロール一覧"
                rows={roles}
                columns={roleColumns}
                getRowKey={roleKey}
                selectable={false}
                emptyMessage="ロールがありません。"
              />
            </section>
          )}
        </>
      )}
      {editingUser && (
        <UserEditor
          key={editingUser.id}
          user={editingUser}
          roles={roles}
          onClose={() => setEditingUser(null)}
          onSaved={() => reload('ユーザー設定を保存しました。')}
        />
      )}
      {editingRole && (
        <RoleEditor
          key={editingRole === 'new' ? 'new' : editingRole.id}
          role={editingRole === 'new' ? undefined : editingRole}
          onClose={() => setEditingRole(null)}
          onSaved={() => reload('ロールを保存しました。')}
        />
      )}
      {deletingRole && (
        <DeleteRoleDialog
          role={deletingRole}
          onClose={() => setDeletingRole(null)}
          onDeleted={() => reload('ロールを削除しました。')}
        />
      )}
    </div>
  )
}
