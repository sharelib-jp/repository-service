import assert from 'node:assert/strict'
import test from 'node:test'
import { parseReferences, rowFromEntry, serializeReferences } from '../src/components/ReferenceInformation/referenceRows.ts'

test('reference rows preserve strings, nested JSON and special property names', () => {
  const source = '{"ISBN":"978", "nested":{"a":[1,true]}, "count":12, "__proto__":null}'
  const parsed = parseReferences(source)
  assert.equal(parsed.ok, true)
  const rows = parsed.entries.map(([name, value], index) => rowFromEntry(index, name, value))
  const result = serializeReferences(rows)
  assert.equal(result.ok, true)
  assert.deepEqual(JSON.parse(result.value), JSON.parse(source))
  assert.equal(rows[0].value, '978')
})

test('editing, adding and deleting rows serializes the remaining values', () => {
  const rows = [rowFromEntry(1, 'ISBN', 'old'), rowFromEntry(2, 'details', [1, 2])]
  const updated = [{ ...rows[0], value: 'new' }, rowFromEntry(3, 'NDLBIBID', 'id')]
  const result = serializeReferences(updated)
  assert.equal(result.ok, true)
  assert.deepEqual(JSON.parse(result.value), { ISBN: 'new', NDLBIBID: 'id' })
  assert.deepEqual(serializeReferences([]), { ok: true, value: '{}' })
})

test('incomplete, duplicate and malformed JSON values do not serialize', () => {
  assert.deepEqual(serializeReferences([rowFromEntry(1, '', '')]), { ok: false, reason: 'empty-name' })
  assert.deepEqual(serializeReferences([rowFromEntry(1, 'ISBN', ''), rowFromEntry(2, 'ISBN', '')]), { ok: false, reason: 'duplicate' })
  assert.deepEqual(serializeReferences([{ ...rowFromEntry(1, 'data', {}), value: '{' }]), { ok: false, reason: 'invalid-value' })
})

test('invalid or non-object input is rejected without losing its source', () => {
  assert.deepEqual(parseReferences(''), { ok: true, entries: [] })
  assert.deepEqual(parseReferences('{'), { ok: false, reason: 'invalid-json' })
  for (const value of ['null', '[]', '1', '"text"']) {
    assert.deepEqual(parseReferences(value), { ok: false, reason: 'not-object' })
  }
})
