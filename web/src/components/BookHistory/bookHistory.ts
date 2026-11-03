export type JsonValue =
  null | boolean | number | string | JsonValue[] | JsonObject
export type JsonObject = { [key: string]: JsonValue }

export type BookHistoryEntry = {
  id: string
  /** The individual book ID used to retrieve this entry. */
  bookId: string
  operation: 'create' | 'update' | 'delete'
  changedAt: string
  actor?: string | null
  reason?: string | null
  entityType?: 'book' | 'book_copy' | 'copy'
  beforeData: JsonObject | null
  afterData: JsonObject | null
}

export type SnapshotValue =
  { exists: false } | { exists: true; value: JsonValue }
export type HistoryDifference = {
  path: string[]
  kind: 'added' | 'removed' | 'changed'
  before: SnapshotValue
  after: SnapshotValue
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function equalJson(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => equalJson(value, right[index]))
    )
  }
  if (isObject(left) && isObject(right)) {
    const keys = Object.keys(left)
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (key) => Object.hasOwn(right, key) && equalJson(left[key], right[key]),
      )
    )
  }
  return false
}

const missing: SnapshotValue = { exists: false }
const present = (value: JsonValue): SnapshotValue => ({ exists: true, value })

/** Compare JSON objects by key; compare arrays as ordered values. */
export function diffSnapshots(
  before: JsonObject | null,
  after: JsonObject | null,
): HistoryDifference[] {
  const differences: HistoryDifference[] = []
  function visit(left: SnapshotValue, right: SnapshotValue, path: string[]) {
    if (left.exists && right.exists && equalJson(left.value, right.value))
      return
    const leftObject =
      left.exists && isObject(left.value) ? left.value : undefined
    const rightObject =
      right.exists && isObject(right.value) ? right.value : undefined
    if ((!left.exists || leftObject) && (!right.exists || rightObject)) {
      const keys = [
        ...new Set([
          ...Object.keys(leftObject ?? {}),
          ...Object.keys(rightObject ?? {}),
        ]),
      ].sort()
      if (keys.length) {
        for (const key of keys) {
          visit(
            leftObject && Object.hasOwn(leftObject, key)
              ? present(leftObject[key])
              : missing,
            rightObject && Object.hasOwn(rightObject, key)
              ? present(rightObject[key])
              : missing,
            [...path, key],
          )
        }
        return
      }
    }
    if (!left.exists && !right.exists) return
    differences.push({
      path,
      kind: !left.exists ? 'added' : !right.exists ? 'removed' : 'changed',
      before: left,
      after: right,
    })
  }
  visit(
    before === null ? missing : present(before),
    after === null ? missing : present(after),
    [],
  )
  return differences
}

export function historiesForBook(
  entries: readonly BookHistoryEntry[],
  bookId: string,
): BookHistoryEntry[] {
  return entries
    .filter((entry) => entry.bookId === bookId)
    .sort((left, right) => {
      const a = Date.parse(left.changedAt)
      const b = Date.parse(right.changedAt)
      return (Number.isNaN(b) ? 0 : b) - (Number.isNaN(a) ? 0 : a)
    })
}
