import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isBookInformationId,
  resolveBookInformationId,
} from '../src/layouts/BookInformationLayout/bookIdLookup.ts'

const bookId = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

test('bibliographic IDs are validated and normalized without a lookup', async () => {
  assert.equal(isBookInformationId(bookId), true)
  for (const value of [
    '81ARZ3NDEKTSV4RRFFQ69G5FAV',
    '01ARZ3NDEKTSV4RRFFQ69G5FAI',
    'abc',
  ]) {
    assert.equal(isBookInformationId(value), false)
  }
  assert.deepEqual(
    await resolveBookInformationId(
      'bibliographic',
      ` ${bookId.toLowerCase()} `,
    ),
    { status: 'resolved', bookId },
  )
  assert.deepEqual(await resolveBookInformationId('bibliographic', 'bad'), {
    status: 'invalid-id',
  })
  assert.deepEqual(await resolveBookInformationId('bibliographic', ' '), {
    status: 'empty',
  })
})

test('copy IDs use the injected lookup, including ULID-shaped copy IDs', async () => {
  let scanned
  const result = await resolveBookInformationId(
    'copy',
    ` ${bookId} `,
    async (value) => {
      scanned = value
      return bookId.toLowerCase()
    },
  )
  assert.equal(scanned, bookId)
  assert.deepEqual(result, { status: 'resolved', bookId })
  assert.deepEqual(await resolveBookInformationId('copy', 'barcode'), {
    status: 'unavailable',
  })
  assert.deepEqual(
    await resolveBookInformationId('copy', 'barcode', async () => null),
    { status: 'not-found' },
  )
  assert.deepEqual(
    await resolveBookInformationId('copy', 'barcode', async () => 'invalid'),
    { status: 'invalid-id' },
  )
})
