import assert from 'node:assert/strict'
import test from 'node:test'
import { addReferenceField, DEFAULT_REFERENCE_FIELDS } from '../src/components/ReferenceInformation/referenceFields.ts'

test('reference choices map to the expected JSON keys', () => {
  assert.deepEqual(DEFAULT_REFERENCE_FIELDS.map(({ value }) => value), ['ISBN', 'NDLBIBID', 'TOHANMARCNO'])
  for (const { value } of DEFAULT_REFERENCE_FIELDS) {
    const result = addReferenceField('', value)
    assert.equal(result.ok, true)
    assert.deepEqual(JSON.parse(result.value), { [value]: '' })
  }
})

test('adding a field preserves existing JSON and refuses duplicates', () => {
  const source = '{ "ISBN": "123", "other": {"x": 1} }  \n'
  const result = addReferenceField(source, 'NDLBIBID')
  assert.equal(result.ok, true)
  assert.deepEqual(JSON.parse(result.value), { ISBN: '123', other: { x: 1 }, NDLBIBID: '' })
  assert.ok(result.value.endsWith('}  \n'))
  assert.deepEqual(addReferenceField(source, 'ISBN'), { ok: false, reason: 'duplicate' })
  assert.deepEqual(addReferenceField('{"__proto__":1}', '__proto__'), { ok: false, reason: 'duplicate' })
})

test('invalid or non-object input is rejected', () => {
  for (const input of ['{', '{"a":1,}']) assert.deepEqual(addReferenceField(input, 'ISBN'), { ok: false, reason: 'invalid-json' })
  for (const input of ['[]', 'null', '"text"', '1']) assert.deepEqual(addReferenceField(input, 'ISBN'), { ok: false, reason: 'not-object' })
})

test('empty objects and escaped custom keys produce valid JSON', () => {
  const result = addReferenceField(' {  } \n', 'custom"key')
  assert.equal(result.ok, true)
  assert.deepEqual(JSON.parse(result.value), { 'custom"key': '' })
})
