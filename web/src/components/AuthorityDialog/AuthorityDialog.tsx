import { reuseLibraryAuthority } from '../../api/authorityResolution'
import { authorityName } from './names'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../atoms/Button'
import { Heading, HeadingTitle } from '../../atoms/Heading'
import { Input } from '../../atoms/Input'
import {
  ModalDialog,
  ModalDialogActions,
  ModalDialogClose,
  ModalDialogContent,
  ModalDialogHeader,
  ModalDialogHeading,
  useModalDialog,
} from '../../atoms/ModalDialog'
import { Select } from '../../atoms/Select'
import { EditableTable, type EditableTableColumn } from '../EditableTable'
import { AuthoritySearchPane } from './AuthoritySearchPane'
import {
  authorityFromCandidate,
  draftId,
  newAuthority,
  validateAuthorities,
  type AlternativeTitle,
  type Authority,
  type AuthorityCandidate,
  type AuthorityKind,
  type AuthorityReference,
  type AuthoritySearch,
} from './authority'
import {
  externalSources,
  searchExternalAuthorities,
  searchLibraryAuthorities,
  type ExternalSource,
} from '../../api/authorities'

export type AuthorityDialogProps = {
  open: boolean
  kind: AuthorityKind
  value: readonly Authority[]
  onOpenChange: (open: boolean) => void
  onApply: (value: Authority[]) => void | Promise<void>
  mode?: 'link' | 'edit'
  searchExternal?: AuthoritySearch
  searchLibrary?: AuthoritySearch
}

const alternativeColumns: readonly EditableTableColumn<
  AlternativeTitle,
  'title' | 'transcription' | 'language'
>[] = [
  { key: 'title', label: '別名', getValue: (row) => row.title },
  {
    key: 'transcription',
    label: '別名ヨミ',
    getValue: (row) => row.transcription,
  },
  { key: 'language', label: '言語', getValue: (row) => row.language },
]
const referenceColumns: readonly EditableTableColumn<
  AuthorityReference,
  'key' | 'value'
>[] = [
  { key: 'key', label: '参照先', getValue: (row) => row.key },
  { key: 'value', label: 'ID・値', getValue: (row) => row.value },
]
const getRowId = (row: { rowId: string }) => row.rowId

export function AuthorityDialog({
  open,
  kind,
  value,
  onOpenChange,
  onApply,
  mode = 'link',
  searchExternal,
  searchLibrary = searchLibraryAuthorities,
}: AuthorityDialogProps) {
  const id = useId()
  const label = kind === 'author' ? '著者' : '出版社'
  const [rows, setRows] = useState<Authority[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const applyingRef = useRef(false)
  const applyRequest = useRef<AbortController | null>(null)
  useEffect(() => () => applyRequest.current?.abort(), [])
  const [sources, setSources] = useState<ExternalSource[]>([])
  const [sourceName, setSourceName] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [searchRequest, setSearchRequest] = useState<{
    query: string
    sequence: number
  }>()
  useEffect(() => {
    if (!open || mode !== 'link' || searchExternal) return
    const controller = new AbortController()
    setSourceError('')
    externalSources('authorities', controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setSources(items)
        setSourceName((current) =>
          items.some((item) => item.name === current)
            ? current
            : (items.find((item) => item.name === 'wikidata')?.name ??
              items[0]?.name ??
              ''),
        )
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSourceError('外部ソースの設定を取得できませんでした。')
      })
    return () => controller.abort()
  }, [open, mode, searchExternal])
  const source = sources.find((item) => item.name === sourceName)
  const externalSearch =
    searchExternal ??
    (source
      ? (((query, kind, signal) =>
          searchExternalAuthorities(
            source,
            query,
            kind,
            signal,
          )) as AuthoritySearch)
      : undefined)

  const { dialogProps, headingProps, closeButtonProps } = useModalDialog({
    open,
    onOpenChange: (next) => {
      if (!applyingRef.current) onOpenChange(next)
    },
  })

  useEffect(() => {
    if (!open) return
    const initial = structuredClone(value) as Authority[]
    setRows(initial)
    setSelectedId(initial[0]?.rowId ?? null)
    setError('')
    setSearchRequest(undefined)
  }, [open, value])

  const selected = rows.find((row) => row.rowId === selectedId)

  function addCandidate(candidate: AuthorityCandidate) {
    if (kind === 'publisher' && rows.length) {
      setError('出版社は１件まで選択できます。')
      return
    }
    const duplicate = rows.some((row) =>
      candidate.source === 'library'
        ? Boolean(candidate.id && row.id === candidate.id)
        : row.references.some(
            (reference) =>
              reference.key === 'Wikidata' && reference.value === candidate.id,
          ),
    )
    if (duplicate) {
      setError('この典拠はすでに追加されています。')
      return
    }
    const next = authorityFromCandidate(candidate, kind)
    setRows((current) => [...current, next])
    setSelectedId(next.rowId)
    setError('')
  }

  function addBlank() {
    if (kind === 'publisher' && rows.length) {
      setError('出版社は１件まで選択できます。')
      return
    }
    const next = newAuthority(kind)
    setRows((current) => [...current, next])
    setSelectedId(next.rowId)
    setError('')
  }

  function update(rowId: string, changes: Partial<Authority>) {
    setRows((current) =>
      current.map((row) =>
        row.rowId === rowId ? { ...row, ...changes } : row,
      ),
    )
    setError('')
  }

  function remove(rowId: string) {
    const next = rows.filter((row) => row.rowId !== rowId)
    setRows(next)
    if (selectedId === rowId) setSelectedId(next[0]?.rowId ?? null)
    setError('')
  }

  async function apply() {
    if (applyingRef.current) return
    const problem = validateAuthorities(rows, kind)
    if (problem) {
      setError(problem)
      return
    }
    applyingRef.current = true
    setApplying(true)
    setError('')
    try {
      const controller = new AbortController()
      applyRequest.current = controller
      const resolved =
        mode === 'link'
          ? await Promise.all(
              rows.map((row) =>
                reuseLibraryAuthority(row, kind, controller.signal),
              ),
            )
          : rows
      if (controller.signal.aborted) return
      const resolvedProblem = validateAuthorities(resolved, kind)
      if (resolvedProblem) throw new Error(resolvedProblem)
      await onApply(structuredClone(resolved))
      onOpenChange(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '典拠情報を保存できませんでした。',
      )
    } finally {
      applyingRef.current = false
      setApplying(false)
    }
  }

  return (
    <ModalDialog {...dialogProps} scroll="inner" width="min(96vw, 96rem)">
      <ModalDialogContent className="h-[min(92dvh,64rem)]" aria-busy={applying}>
        <fieldset disabled={applying} className="contents">
          <ModalDialogHeader>
            <ModalDialogHeading {...headingProps}>
              {mode === 'edit'
                ? `${label}典拠情報を編集`
                : `${label}典拠情報と紐付け`}
            </ModalDialogHeading>
            <ModalDialogClose {...closeButtonProps} />
          </ModalDialogHeader>
          {open && (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-6">
              <div
                className={`grid min-h-full gap-3 lg:h-full ${mode === 'link' ? 'lg:grid-cols-2' : ''}`}
              >
                {mode === 'link' && (
                  <div className="grid min-h-0 gap-3 lg:grid-rows-2">
                    <AuthoritySearchPane
                      title="外部ソースから検索"
                      key={sourceName}
                      searchRequest={searchRequest}
                      sourceControl={
                        !searchExternal && (
                          <label className="flex flex-col gap-1">
                            検索ソース
                            <Select
                              blockSize="md"
                              value={sourceName}
                              onChange={(event) =>
                                setSourceName(event.target.value)
                              }
                            >
                              <option value="">選択してください</option>
                              {sources.map((item) => (
                                <option key={item.name} value={item.name}>
                                  {item.label || item.name}
                                </option>
                              ))}
                            </Select>
                            {sourceError && (
                              <span role="status">{sourceError}</span>
                            )}
                          </label>
                        )
                      }
                      unavailableMessage="利用できる外部ソースを選択してください。"
                      kind={kind}
                      search={externalSearch}
                      onAdd={addCandidate}
                    />
                    <AuthoritySearchPane
                      title="館内の典拠から検索"
                      kind={kind}
                      search={searchLibrary}
                      onAdd={addCandidate}
                    />
                  </div>
                )}
                <div
                  className={`grid min-h-0 gap-3 ${mode === 'link' ? 'lg:grid-rows-3' : 'lg:grid-rows-2'}`}
                >
                  {mode === 'link' && (
                    <section className="flex min-h-64 min-w-0 flex-col gap-3 rounded-8 border border-solid-gray-300 p-3 lg:min-h-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Heading size="18" hasChip={false}>
                          <HeadingTitle level="h3">
                            この書籍の{label}典拠
                          </HeadingTitle>
                        </Heading>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={addBlank}
                        >
                          新規作成
                        </Button>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto">
                        <table className="w-full min-w-96 border-collapse text-dns-16N-130">
                          <caption className="sr-only">
                            書籍に紐付ける{label}典拠
                          </caption>
                          <thead>
                            <tr className="border-b border-black bg-solid-gray-100">
                              <th scope="col" className="p-2 text-left">
                                典拠 ID
                              </th>
                              <th scope="col" className="p-2 text-left">
                                典拠タイトル
                              </th>
                              {kind === 'author' && (
                                <th scope="col" className="p-2 text-left">
                                  役割
                                </th>
                              )}
                              <th scope="col" className="p-2">
                                <span className="sr-only">操作</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row, index) => (
                              <tr
                                key={row.rowId}
                                className={`border-b border-solid-gray-300 ${selectedId === row.rowId ? 'bg-key-100' : ''}`}
                              >
                                <td className="p-2">{row.id || '未採番'}</td>
                                <td className="p-2">
                                  <button
                                    type="button"
                                    aria-pressed={selectedId === row.rowId}
                                    onClick={() => {
                                      setSelectedId(row.rowId)
                                      if (row.title.trim())
                                        setSearchRequest((current) => ({
                                          query: row.title,
                                          sequence:
                                            (current?.sequence ?? 0) + 1,
                                        }))
                                    }}
                                    className="text-left text-key-900 underline focus-visible:outline focus-visible:outline-4 focus-visible:outline-black"
                                  >
                                    {row.title || `典拠 ${index + 1}（未入力）`}
                                  </button>
                                </td>
                                {kind === 'author' && (
                                  <td className="p-2">
                                    <input
                                      aria-label={`${row.title || `典拠 ${index + 1}`}の役割`}
                                      className="w-24 rounded-4 border border-solid-gray-600 bg-white p-2"
                                      value={row.role}
                                      onChange={(event) =>
                                        update(row.rowId, {
                                          role: event.target.value,
                                        })
                                      }
                                    />
                                  </td>
                                )}
                                <td className="p-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="text"
                                    aria-label={`${row.title || `典拠 ${index + 1}`}の紐付けを解除`}
                                    onClick={() => remove(row.rowId)}
                                  >
                                    解除
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {rows.length === 0 && (
                          <p className="p-2 text-solid-gray-700">
                            検索結果から追加するか、新規作成してください。
                          </p>
                        )}
                      </div>
                    </section>
                  )}
                  <section className="min-h-64 min-w-0 overflow-auto rounded-8 border border-solid-gray-300 p-3 lg:min-h-0">
                    <Heading size="18" hasChip={false}>
                      <HeadingTitle level="h3">{label}の典拠情報</HeadingTitle>
                    </Heading>
                    {selected ? (
                      <div className="mt-3 flex flex-col gap-3">
                        <p>典拠 ID: {selected.id || '未採番'}</p>
                        <div className="grid gap-3 xl:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            典拠タイトル
                            <Input
                              blockSize="md"
                              className="w-full"
                              value={selected.title}
                              onBlur={() => {
                                if (kind === 'author')
                                  update(selected.rowId, {
                                    title: authorityName(selected.title),
                                  })
                              }}
                              onChange={(event) =>
                                update(selected.rowId, {
                                  title: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            典拠タイトルヨミ
                            <Input
                              blockSize="md"
                              className="w-full"
                              value={selected.transcription}
                              onBlur={() => {
                                if (kind === 'author')
                                  update(selected.rowId, {
                                    transcription: authorityName(
                                      selected.transcription,
                                    ),
                                  })
                              }}
                              onChange={(event) =>
                                update(selected.rowId, {
                                  transcription: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            種別
                            <Select
                              blockSize="md"
                              className="w-full"
                              value={selected.type}
                              onChange={(event) =>
                                update(selected.rowId, {
                                  type: event.target.value as Authority['type'],
                                })
                              }
                            >
                              <option value="Other">その他・不明</option>
                              <option value="Person">人物</option>
                              <option value="Organization">団体</option>
                            </Select>
                          </label>
                          <label className="flex flex-col gap-1">
                            タイトルの言語
                            <Input
                              blockSize="md"
                              className="w-full"
                              value={selected.language}
                              onChange={(event) =>
                                update(selected.rowId, {
                                  language: event.target.value,
                                })
                              }
                            />
                          </label>
                          {(['birth', 'foundation'] as const).map(
                            (dateKind) => {
                              const dateKey =
                                dateKind === 'birth'
                                  ? 'birthDate'
                                  : 'foundationDate'
                              const precisionKey =
                                dateKind === 'birth'
                                  ? 'birthDatePrecision'
                                  : 'foundationDatePrecision'
                              const dateLabel =
                                dateKind === 'birth' ? '生年月日' : '設立日'
                              return (
                                <div key={dateKind} className="grid gap-2">
                                  <label className="flex flex-col gap-1">
                                    {dateLabel}
                                    <Input
                                      blockSize="md"
                                      className="w-full"
                                      value={selected[dateKey]}
                                      onChange={(event) =>
                                        update(selected.rowId, {
                                          [dateKey]: event.target.value,
                                        })
                                      }
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1">
                                    {dateLabel}の精度
                                    <Select
                                      blockSize="md"
                                      className="w-full"
                                      value={selected[precisionKey]}
                                      onChange={(event) =>
                                        update(selected.rowId, {
                                          [precisionKey]: event.target.value,
                                        })
                                      }
                                    >
                                      <option value="">不明</option>
                                      <option value="year_only">年</option>
                                      <option value="year_month">年月</option>
                                      <option value="exact">年月日</option>
                                    </Select>
                                  </label>
                                </div>
                              )
                            },
                          )}
                        </div>
                        <p className="text-solid-gray-700">
                          日付は YYYY、YYYY-MM、YYYY-MM-DD
                          の形式で入力してください。
                        </p>
                        <Heading size="16" hasChip={false}>
                          <HeadingTitle level="h4">別名</HeadingTitle>
                        </Heading>
                        <EditableTable
                          key={selected.rowId}
                          caption="別名"
                          columns={alternativeColumns}
                          rows={selected.alternativeTitles}
                          getRowKey={getRowId}
                          onCellChange={(row, column, value) =>
                            update(selected.rowId, {
                              alternativeTitles: selected.alternativeTitles.map(
                                (item) =>
                                  item.rowId === row.rowId
                                    ? { ...item, [column]: value }
                                    : item,
                              ),
                            })
                          }
                          onRowsChange={(alternativeTitles) =>
                            update(selected.rowId, { alternativeTitles })
                          }
                          onAddRow={() =>
                            update(selected.rowId, {
                              alternativeTitles: [
                                ...selected.alternativeTitles,
                                {
                                  rowId: draftId(),
                                  title: '',
                                  transcription: '',
                                  language: 'ja',
                                },
                              ],
                            })
                          }
                          addRowLabel="別名を追加"
                          enterColumn="title"
                        />
                      </div>
                    ) : (
                      <p className="mt-3 text-solid-gray-700">
                        編集する典拠を選択してください。
                      </p>
                    )}
                  </section>
                  <section className="min-h-64 min-w-0 overflow-auto rounded-8 border border-solid-gray-300 p-3 lg:min-h-0">
                    <Heading size="18" hasChip={false}>
                      <HeadingTitle level="h3">
                        {label}の典拠参照情報
                      </HeadingTitle>
                    </Heading>
                    {selected ? (
                      <div className="mt-3">
                        <p className="mb-2 text-solid-gray-700">
                          例: Wikidata / Q1000000、NDL / 1234
                        </p>
                        <EditableTable
                          key={selected.rowId}
                          caption="典拠参照情報"
                          columns={referenceColumns}
                          rows={selected.references}
                          getRowKey={getRowId}
                          onCellChange={(row, column, value) =>
                            update(selected.rowId, {
                              references: selected.references.map((item) =>
                                item.rowId === row.rowId
                                  ? { ...item, [column]: value }
                                  : item,
                              ),
                            })
                          }
                          onRowsChange={(references) =>
                            update(selected.rowId, { references })
                          }
                          onAddRow={() =>
                            update(selected.rowId, {
                              references: [
                                ...selected.references,
                                { rowId: draftId(), key: '', value: '' },
                              ],
                            })
                          }
                          addRowLabel="参照情報を追加"
                          enterColumn="key"
                        />
                      </div>
                    ) : (
                      <p className="mt-3 text-solid-gray-700">
                        編集する典拠を選択してください。
                      </p>
                    )}
                  </section>
                </div>
              </div>
            </div>
          )}
          <ModalDialogActions className="flex flex-wrap items-center justify-end gap-3">
            {error && (
              <p
                role="alert"
                id={`${id}-error`}
                className="mr-auto text-error-1"
              >
                {error}
              </p>
            )}
            <Button
              type="button"
              size="md"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              size="md"
              variant="solid-fill"
              aria-describedby={error ? `${id}-error` : undefined}
              onClick={apply}
            >
              {applying ? '処理中…' : '反映'}
            </Button>
          </ModalDialogActions>
        </fieldset>
      </ModalDialogContent>
    </ModalDialog>
  )
}
