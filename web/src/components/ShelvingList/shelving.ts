import type { CopyData } from '../../api/books.ts'
import { localDateTime } from './dateTime.ts'

export type ShelvingColumn = 'bookId' | 'deliveredAt' | 'status' | 'loanLabel'
export type ShelvingValues = Record<ShelvingColumn, string>
export type ShelvingRow = ShelvingValues & {
  rowId: string
  id?: string
  version?: number
  originalDeliveredAt?: string | null
}
export const conditions = {
  normal: '問題なし',
  lost: '紛失',
  damaged: '汚損・破損',
  stolen: '盗難',
  unknown: '不明',
}
export const loanPolicies = {
  available: '貸出可',
  suspended: '貸出一時停止',
  no_loan: '貸出不可（禁帯出）',
  in_library_only: '貸出不可（館内閲覧のみ）',
  no_access: '貸出不可（館内閲覧不可）',
}
let sequence = 0
export function emptyShelvingValues(): ShelvingValues {
  return {
    bookId: '',
    deliveredAt: localDateTime(new Date()),
    status: conditions.normal,
    loanLabel: loanPolicies.available,
  }
}
export function shelvingRow(values: ShelvingValues): ShelvingRow {
  return { ...values, rowId: `shelving-${++sequence}` }
}
export function shelvingFromCopy(copy: CopyData): ShelvingRow {
  return {
    ...shelvingRow({
      bookId: copy.managementCode,
      deliveredAt: copy.deliveredAt
        ? localDateTime(new Date(copy.deliveredAt))
        : '',
      status:
        conditions[copy.condition as keyof typeof conditions] ?? copy.condition,
      loanLabel:
        loanPolicies[copy.loanPolicy as keyof typeof loanPolicies] ??
        copy.loanPolicy,
    }),
    id: copy.id,
    version: copy.version,
    originalDeliveredAt: copy.deliveredAt,
  }
}
export function copyFromShelving(row: ShelvingRow): CopyData {
  const managementCode = row.bookId.trim()
  if (!managementCode)
    throw new Error('配架情報の書籍 ID（管理コード）を入力してください。')
  const condition = Object.entries(conditions).find(
    ([, label]) => label === row.status,
  )?.[0]
  const loanPolicy = Object.entries(loanPolicies).find(
    ([, label]) => label === row.loanLabel,
  )?.[0]
  if (!condition || !loanPolicy)
    throw new Error('配架情報の状態・貸出ラベルを確認してください。')
  let deliveredAt: string | null = null
  if (row.deliveredAt) {
    if (
      row.originalDeliveredAt &&
      localDateTime(new Date(row.originalDeliveredAt)) === row.deliveredAt
    )
      deliveredAt = row.originalDeliveredAt
    else {
      const date = new Date(row.deliveredAt)
      if (
        !Number.isFinite(date.getTime()) ||
        localDateTime(date) !== row.deliveredAt
      )
        throw new Error('配架情報の納入日時を確認してください。')
      deliveredAt = date.toISOString()
    }
  }
  return {
    id: row.id,
    version: row.version,
    managementCode,
    deliveredAt,
    condition,
    loanPolicy,
  }
}
