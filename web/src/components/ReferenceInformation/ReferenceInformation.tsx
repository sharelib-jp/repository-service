import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../atoms/Button'
import { Heading, HeadingTitle } from '../../atoms/Heading'
import { EditableTable, type EditableTableColumn } from '../EditableTable'
import { JsonEditor } from '../JsonEditor'
import { SelectionDialog, type SelectionOption } from '../SelectionDialog'
import { DEFAULT_REFERENCE_FIELDS } from './referenceFields'
import {
  parseReferences,
  rowFromEntry,
  serializeReferences,
  type ReferenceRow,
} from './referenceRows'

export type ReferenceInformationProps = {
  value: string
  onChange: (value: string) => void
  options?: readonly SelectionOption[]
  onValidityChange?: (valid: boolean) => void
}

type Column = 'name' | 'value'
const columns: readonly EditableTableColumn<ReferenceRow, Column>[] = [
  { key: 'name', label: '項目名', getValue: (row) => row.name },
  { key: 'value', label: '値', getValue: (row) => row.value },
]
const rowKey = (row: ReferenceRow) => row.id

export function ReferenceInformation({
  value,
  onChange,
  options = DEFAULT_REFERENCE_FIELDS,
  onValidityChange,
}: ReferenceInformationProps) {
  const id = useId()
  const nextId = useRef(0)
  const lastValue = useRef(value)
  const [rows, setRows] = useState<ReferenceRow[]>(() => {
    const parsed = parseReferences(value)
    return parsed.ok
      ? parsed.entries.map(([name, entry]) =>
          rowFromEntry(nextId.current++, name, entry),
        )
      : []
  })
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const parsed = parseReferences(value)
  const serialized = serializeReferences(rows)
  const valid = parsed.ok && serialized.ok
  useEffect(() => {
    onValidityChange?.(valid)
  }, [valid, onValidityChange])

  useEffect(() => {
    if (value === lastValue.current) return
    lastValue.current = value
    const next = parseReferences(value)
    setRows(
      next.ok
        ? next.entries.map(([name, entry]) =>
            rowFromEntry(nextId.current++, name, entry),
          )
        : [],
    )
  }, [value])

  function changeRows(next: ReferenceRow[]) {
    setRows(next)
    const result = serializeReferences(next)
    if (result.ok) {
      lastValue.current = result.value
      onChange(result.value)
    }
  }

  function changeOpen(next: boolean) {
    setError('')
    setOpen(next)
  }

  function addField(name: string) {
    if (rows.some((row) => row.name === name)) {
      setError('この項目はすでに追加されています。')
      return
    }
    changeRows([...rows, rowFromEntry(nextId.current++, name, '')])
    changeOpen(false)
  }

  function updateCell(row: ReferenceRow, column: Column, next: string) {
    changeRows(
      rows.map((item) =>
        item.id === row.id ? { ...item, [column]: next } : item,
      ),
    )
  }

  const validationMessages = {
    'empty-name': 'すべての行に項目名を入力すると、変更が反映されます。',
    duplicate: '項目名の重複を解消すると、変更が反映されます。',
    'invalid-value': 'JSON 形式の値を修正すると、変更が反映されます。',
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex min-w-0 flex-col gap-2"
    >
      <Heading hasChip={false} size="20">
        <HeadingTitle id={`${id}-heading`} level="h3">
          参照情報
        </HeadingTitle>
      </Heading>
      {parsed.ok ? (
        <>
          <EditableTable
            caption="参照情報"
            columns={columns}
            rows={rows}
            getRowKey={rowKey}
            onCellChange={updateCell}
            onRowsChange={changeRows}
            onAddRow={() =>
              changeRows([...rows, rowFromEntry(nextId.current++, '', '')])
            }
            enterColumn="name"
            addRowLabel="参照情報を追加"
          />
          {rows.some((row) => row.jsonValue) && (
            <p className="text-solid-gray-700">
              文字列以外の値は JSON 形式で編集してください。
            </p>
          )}
          {!serialized.ok && (
            <p role="alert" className="text-error-1">
              {validationMessages[serialized.reason]}
            </p>
          )}
          <Button
            type="button"
            size="md"
            variant="outline"
            onClick={() => changeOpen(true)}
            className="w-full"
          >
            参照情報を選択して追加
          </Button>
          <SelectionDialog
            open={open}
            onOpenChange={changeOpen}
            title="追加する参照情報を選択"
            options={options}
            onSelect={addField}
            error={error}
          />
        </>
      ) : (
        <>
          <p role="alert" className="text-error-1">
            {parsed.reason === 'invalid-json'
              ? 'JSON の形式を確認してください。'
              : '参照情報は JSON オブジェクトで入力してください。'}
          </p>
          <JsonEditor
            label="参照情報（JSON）"
            name="referenceInformation"
            value={value}
            onChange={onChange}
          />
        </>
      )}
    </section>
  )
}
