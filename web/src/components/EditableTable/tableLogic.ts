export function shouldFocusNextRow(key: string, isComposing: boolean, keyCode: number): boolean {
  return key === 'Enter' && !isComposing && keyCode !== 229
}

export function shouldDeleteRows(key: string, isComposing: boolean, keyCode: number, target: { tagName: string; type?: string; isContentEditable?: boolean }): boolean {
  if (key !== 'Delete' || isComposing || keyCode === 229 || target.isContentEditable) return false
  const tag = target.tagName.toLowerCase()
  return tag !== 'textarea' && tag !== 'select' && (tag !== 'input' || target.type === 'checkbox')
}

export function removeSelectedRows<Row, Key>(rows: readonly Row[], selected: ReadonlySet<Key>, getRowKey: (row: Row) => Key): Row[] {
  return rows.filter((row) => !selected.has(getRowKey(row)))
}
