import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Checkbox } from '../../atoms/Checkbox'
import {
  removeSelectedRows,
  shouldDeleteRows,
  shouldFocusNextRow,
} from './tableLogic'

export type EditableTableColumn<Row, ColumnKey extends string> = {
  key: ColumnKey
  label: string
  type?: 'text' | 'datetime-local' | 'select'
  options?: readonly { value: string; label: string }[]
  getValue: (row: Row) => string
  renderCell?: (row: Row) => ReactNode
}

export type EditableTableProps<
  Row,
  ColumnKey extends string,
  RowKey extends string | number,
> = {
  caption: string
  columns: readonly EditableTableColumn<Row, ColumnKey>[]
  rows: readonly Row[]
  getRowKey: (row: Row) => RowKey
  onCellChange?: (row: Row, column: ColumnKey, value: string) => void
  onRowsChange?: (rows: Row[]) => void
  onAddRow?: () => void
  addRowLabel?: string
  enterColumn?: ColumnKey
  selectable?: boolean
  scrollable?: boolean
  emptyMessage?: string
}

export function EditableTable<
  Row,
  ColumnKey extends string,
  RowKey extends string | number,
>({
  caption,
  columns,
  rows,
  getRowKey,
  onCellChange,
  onRowsChange,
  onAddRow,
  addRowLabel = '行を追加',
  enterColumn,
  selectable = true,
  scrollable = false,
  emptyMessage,
}: EditableTableProps<Row, ColumnKey, RowKey>) {
  const [selected, setSelected] = useState<Set<RowKey>>(() => new Set())
  const addButton = useRef<HTMLButtonElement>(null)
  const enterInputs = useRef(new Map<RowKey, HTMLInputElement>())
  const focusAddedRow = useRef(false)
  const rowKeys = rows.map(getRowKey)
  const selectedKeys = rowKeys.filter((key) => selected.has(key))
  const allSelected = rows.length > 0 && selectedKeys.length === rows.length

  useLayoutEffect(() => {
    if (!focusAddedRow.current) return
    focusAddedRow.current = false
    const lastRow = rows.at(-1)
    if (lastRow) enterInputs.current.get(getRowKey(lastRow))?.focus()
  }, [rows, getRowKey])

  function toggleRow(key: RowKey) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function deleteSelected() {
    if (selectedKeys.length === 0) return
    onRowsChange?.(removeSelectedRows(rows, selected, getRowKey))
    setSelected(new Set())
    addButton.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      !selectedKeys.length ||
      !shouldDeleteRows(
        event.key,
        event.nativeEvent.isComposing,
        event.nativeEvent.keyCode,
        event.target as HTMLElement,
      )
    )
      return
    event.preventDefault()
    deleteSelected()
  }

  function focusNext(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (
      !shouldFocusNextRow(
        event.key,
        event.nativeEvent.isComposing,
        event.nativeEvent.keyCode,
      )
    )
      return
    const next = rows[index + 1]
    if (next) {
      event.preventDefault()
      enterInputs.current.get(getRowKey(next))?.focus()
    }
  }

  const cellClass =
    'min-w-40 w-full rounded-4 border border-solid-gray-600 bg-white px-2 py-2 focus:outline focus:outline-4 focus:outline-black focus:outline-offset-2 focus:ring-2 focus:ring-yellow-300'

  return (
    <div
      onKeyDown={handleKeyDown}
      className={
        scrollable ? 'flex h-full min-h-0 min-w-0 flex-col' : undefined
      }
    >
      <div
        className={
          scrollable
            ? 'min-h-0 min-w-0 flex-1 overflow-auto'
            : 'min-w-0 overflow-x-auto'
        }
        tabIndex={scrollable ? 0 : undefined}
        role={scrollable ? 'region' : undefined}
        aria-label={scrollable ? caption : undefined}
      >
        <table className="w-full min-w-max border-collapse text-dns-16N-130">
          <caption className="sr-only">{caption}</caption>
          <thead className={scrollable ? 'sticky top-0 z-10' : undefined}>
            <tr className="border-b border-black bg-solid-gray-100">
              {selectable && (
                <th scope="col" className="p-2">
                  <Checkbox
                    aria-label="すべての行を選択"
                    disabled={rows.length === 0}
                    checked={allSelected}
                    ref={(element) => {
                      if (element)
                        element.indeterminate =
                          selectedKeys.length > 0 && !allSelected
                    }}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(rowKeys))
                    }
                  />
                </th>
              )}
              {columns.map((column) => (
                <th key={column.key} scope="col" className="p-2 text-left">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const rowKey = getRowKey(row)
              const selectedClass = selected.has(rowKey) ? 'bg-key-100' : ''
              return (
                <tr key={rowKey} className="border-b border-solid-gray-300">
                  {selectable && (
                    <td className={`p-2 ${selectedClass}`}>
                      <Checkbox
                        aria-label={`${index + 1}行目を選択`}
                        checked={selected.has(rowKey)}
                        onChange={() => toggleRow(rowKey)}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key} className={`p-2 ${selectedClass}`}>
                      {column.renderCell ? (
                        column.renderCell(row)
                      ) : column.type === 'select' ? (
                        <select
                          aria-label={`${index + 1}行目の${column.label}`}
                          className={cellClass}
                          value={column.getValue(row)}
                          onChange={(event) =>
                            onCellChange?.(row, column.key, event.target.value)
                          }
                        >
                          {column.options?.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={`${index + 1}行目の${column.label}`}
                          className={cellClass}
                          type={column.type ?? 'text'}
                          value={column.getValue(row)}
                          onChange={(event) =>
                            onCellChange?.(row, column.key, event.target.value)
                          }
                          ref={
                            column.key === enterColumn
                              ? (element) => {
                                  if (element)
                                    enterInputs.current.set(rowKey, element)
                                  else enterInputs.current.delete(rowKey)
                                }
                              : undefined
                          }
                          onKeyDown={
                            column.key === enterColumn
                              ? (event) => focusNext(event, index)
                              : undefined
                          }
                        />
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
            {rows.length === 0 && emptyMessage && (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="p-4 text-solid-gray-700"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
            {onAddRow && (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="border-b border-solid-gray-300 p-0"
                >
                  <button
                    ref={addButton}
                    type="button"
                    className="w-full px-4 py-3 text-left text-key-900 hover:bg-key-50 focus-visible:outline focus-visible:outline-4 focus-visible:outline-black focus-visible:outline-offset-2"
                    onClick={() => {
                      focusAddedRow.current = true
                      onAddRow()
                    }}
                  >
                    ＋ {addRowLabel}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {selectable && onRowsChange && selectedKeys.length > 0 && (
        <button
          type="button"
          className="mt-2 rounded-4 px-2 py-1 text-key-900 underline focus-visible:outline focus-visible:outline-4 focus-visible:outline-black"
          onClick={deleteSelected}
        >
          選択した行を削除（{selectedKeys.length}）
        </button>
      )}
    </div>
  )
}
