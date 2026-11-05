import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../atoms/Button'
import { Heading, HeadingTitle } from '../../atoms/Heading'
import { Input } from '../../atoms/Input'
import {
  ModalDialog,
  ModalDialogActions,
  ModalDialogBody,
  ModalDialogClose,
  ModalDialogContent,
  ModalDialogHeader,
  ModalDialogHeading,
  ModalDialogScrollArea,
  useModalDialog,
} from '../../atoms/ModalDialog'
import { Select } from '../../atoms/Select'
import { EditableTable, type EditableTableColumn } from '../EditableTable'
import { localDateTime } from './dateTime'

import {
  conditions,
  loanPolicies,
  emptyShelvingValues,
  shelvingRow,
  type ShelvingColumn as Column,
  type ShelvingValues,
  type ShelvingRow,
} from './shelving'

const statuses = Object.values(conditions)
const loanLabels = Object.values(loanPolicies)
const options = (values: readonly string[]) =>
  values.map((value) => ({ value, label: value }))
const columns: readonly EditableTableColumn<ShelvingRow, Column>[] = [
  { key: 'bookId', label: '書籍 ID', getValue: (row) => row.bookId },
  {
    key: 'deliveredAt',
    label: '納入日時',
    type: 'datetime-local',
    getValue: (row) => row.deliveredAt,
  },
  {
    key: 'status',
    label: '状態',
    type: 'select',
    options: options(statuses),
    getValue: (row) => row.status,
  },
  {
    key: 'loanLabel',
    label: '貸出ラベル',
    type: 'select',
    options: options(loanLabels),
    getValue: (row) => row.loanLabel,
  },
]

function rowKey(row: ShelvingRow) {
  return row.rowId
}

export function ShelvingList({
  value: rows,
  onChange,
}: {
  value: ShelvingRow[]
  onChange: (rows: ShelvingRow[]) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ShelvingValues>(emptyShelvingValues)
  const [dateEdited, setDateEdited] = useState(false)
  const { dialogProps, headingProps, closeButtonProps } = useModalDialog({
    open,
    onOpenChange: setOpen,
  })

  function appendRow(values: ShelvingValues) {
    onChange([...rows, shelvingRow(values)])
  }

  function addFromDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.bookId.trim()) return
    appendRow({
      ...draft,
      bookId: draft.bookId.trim(),
      deliveredAt: dateEdited ? draft.deliveredAt : localDateTime(new Date()),
    })
    setOpen(false)
  }

  function updateRow(row: ShelvingRow, column: Column, value: string) {
    onChange(
      rows.map((item) =>
        item.rowId === row.rowId ? { ...item, [column]: value } : item,
      ),
    )
  }

  function openDialog() {
    setDraft(emptyShelvingValues())
    setDateEdited(false)
    setOpen(true)
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading hasChip={false} size="20">
          <HeadingTitle id={`${id}-heading`} level="h3">
            配架設定（簡易）
          </HeadingTitle>
        </Heading>
        <Button type="button" size="md" variant="outline" onClick={openDialog}>
          追加
        </Button>
      </div>
      <EditableTable
        caption="書籍の配架情報"
        columns={columns}
        rows={rows}
        getRowKey={rowKey}
        onCellChange={updateRow}
        onRowsChange={onChange}
        onAddRow={() => appendRow(emptyShelvingValues())}
        enterColumn="bookId"
        addRowLabel="書籍を追加"
      />
      <ModalDialog {...dialogProps} scroll="inner" width="36rem">
        <ModalDialogContent>
          <ModalDialogHeader>
            <ModalDialogHeading {...headingProps}>
              書籍を追加
            </ModalDialogHeading>
            <ModalDialogClose {...closeButtonProps} />
          </ModalDialogHeader>
          <form onSubmit={addFromDialog} className="flex min-h-0 flex-col">
            <ModalDialogScrollArea>
              <ModalDialogBody className="flex flex-col gap-4">
                {columns.map(({ key, label, type, options: columnOptions }) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span>
                      {label}
                      {key === 'bookId' && '（必須）'}
                    </span>
                    {type === 'select' ? (
                      <Select
                        blockSize="md"
                        className="w-full"
                        value={draft[key]}
                        onChange={(event) =>
                          setDraft({ ...draft, [key]: event.target.value })
                        }
                      >
                        {columnOptions?.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        blockSize="md"
                        className="w-full"
                        type={type ?? 'text'}
                        required={key === 'bookId'}
                        pattern={key === 'bookId' ? '.*\\S.*' : undefined}
                        title={
                          key === 'bookId'
                            ? '書籍 ID を入力してください。'
                            : undefined
                        }
                        value={draft[key]}
                        onChange={(event) => {
                          if (key === 'deliveredAt') setDateEdited(true)
                          setDraft({ ...draft, [key]: event.target.value })
                        }}
                      />
                    )}
                  </label>
                ))}
              </ModalDialogBody>
            </ModalDialogScrollArea>
            <ModalDialogActions className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                size="md"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                キャンセル
              </Button>
              <Button type="submit" size="md" variant="solid-fill">
                追加
              </Button>
            </ModalDialogActions>
          </form>
        </ModalDialogContent>
      </ModalDialog>
    </section>
  )
}
