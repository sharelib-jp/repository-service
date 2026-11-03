import assert from 'node:assert/strict'
import test from 'node:test'
import {
  diffSnapshots,
  historiesForBook,
} from '../src/components/BookHistory/bookHistory.ts'

test('object differences distinguish additions, removals, null and empty values', () => {
  const before = {
    book: { Title: '旧', deleted: null, unchanged: true },
    empty: '',
    nullValue: null,
  }
  const after = {
    book: { Title: '新', added: null, unchanged: true },
    empty: null,
    nullValue: null,
  }
  assert.deepEqual(diffSnapshots(before, after), [
    {
      path: ['book', 'Title'],
      kind: 'changed',
      before: { exists: true, value: '旧' },
      after: { exists: true, value: '新' },
    },
    {
      path: ['book', 'added'],
      kind: 'added',
      before: { exists: false },
      after: { exists: true, value: null },
    },
    {
      path: ['book', 'deleted'],
      kind: 'removed',
      before: { exists: true, value: null },
      after: { exists: false },
    },
    {
      path: ['empty'],
      kind: 'changed',
      before: { exists: true, value: '' },
      after: { exists: true, value: null },
    },
  ])
})

test('object key order is ignored and arrays are compared as ordered values', () => {
  assert.deepEqual(
    diffSnapshots(
      { item: { a: 1, b: 2 }, authors: [{ a: 1, b: 2 }] },
      { item: { b: 2, a: 1 }, authors: [{ b: 2, a: 1 }] },
    ),
    [],
  )
  const differences = diffSnapshots(
    { authors: ['A', 'B'] },
    { authors: ['B', 'A'] },
  )
  assert.equal(differences.length, 1)
  assert.deepEqual(differences[0].path, ['authors'])
  assert.equal(differences[0].kind, 'changed')
})

test('create, delete, empty objects and special keys retain their meaning', () => {
  assert.deepEqual(diffSnapshots(null, { empty: {}, 'a.b': 0 }), [
    {
      path: ['a.b'],
      kind: 'added',
      before: { exists: false },
      after: { exists: true, value: 0 },
    },
    {
      path: ['empty'],
      kind: 'added',
      before: { exists: false },
      after: { exists: true, value: {} },
    },
  ])
  assert.deepEqual(diffSnapshots({ a: true }, null)[0].kind, 'removed')
  assert.deepEqual(diffSnapshots(null, null), [])
  const original = JSON.parse('{"__proto__":{"value":1}}')
  assert.deepEqual(
    diffSnapshots(original, JSON.parse('{"__proto__":null}'))[0].path,
    ['__proto__'],
  )
})

test('book history is filtered by exact book ID and shown newest first', () => {
  const entries = [
    { id: 'old', bookId: 'A', changedAt: '2026-01-01T00:00:00Z' },
    { id: 'other', bookId: 'AB', changedAt: '2026-01-03T00:00:00Z' },
    { id: 'new', bookId: 'A', changedAt: '2026-01-02T00:00:00Z' },
  ]
  assert.deepEqual(
    historiesForBook(entries, 'A').map((item) => item.id),
    ['new', 'old'],
  )
  assert.deepEqual(
    entries.map((item) => item.id),
    ['old', 'other', 'new'],
  )
})
