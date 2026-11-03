import assert from 'node:assert/strict'
import test from 'node:test'
import { removeSelectedRows, shouldDeleteRows } from '../src/components/EditableTable/tableLogic.ts'
import { localDateTime } from '../src/components/ShelvingList/dateTime.ts'

test('Delete removes selected rows without changing the other rows', () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
  assert.deepEqual(removeSelectedRows(rows, new Set([1, 3]), (row) => row.id), [{ id: 2 }])
  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }, { id: 3 }])
})

test('Delete on row selection works without interfering with editing or IME', () => {
  const checkbox = { tagName: 'INPUT', type: 'checkbox' }
  assert.equal(shouldDeleteRows('Delete', false, 46, checkbox), true)
  assert.equal(shouldDeleteRows('Delete', true, 46, checkbox), false)
  assert.equal(shouldDeleteRows('Delete', false, 229, checkbox), false)
  for (const target of [
    { tagName: 'INPUT', type: 'text' },
    { tagName: 'INPUT', type: 'datetime-local' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
  ]) assert.equal(shouldDeleteRows('Delete', false, 46, target), false)
})

test('new dates use local calendar time for datetime-local inputs', () => {
  assert.equal(localDateTime(new Date(2026, 0, 2, 3, 4, 59)), '2026-01-02T03:04')
  assert.equal(localDateTime(new Date(2026, 11, 31, 23, 59)), '2026-12-31T23:59')
})
