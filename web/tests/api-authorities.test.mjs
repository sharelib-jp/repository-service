import assert from 'node:assert/strict'
import test from 'node:test'
import { authorityFromData, authorityToData } from '../src/api/authorities.ts'
import {
  apiRequest,
  setAccessTokenProvider,
  ApiError,
} from '../src/api/client.ts'

test('authority mapping preserves JSON reference values and concurrency timestamps', () => {
  const data = {
    id: 'local-id',
    title: '作者',
    updatedAt: '2026-11-04T00:00:00Z',
    references: { external: { id: 12 }, another: null },
    alternativeTitles: [
      { title: '別名', transcription: 'ベツメイ', language: 'ja' },
    ],
  }
  const form = authorityFromData(data, 'author', true)
  const result = authorityToData(form)
  assert.equal(result.id, data.id)
  assert.equal(result.updatedAt, data.updatedAt)
  assert.deepEqual(result.references, data.references)
  assert.deepEqual(result.alternativeTitles, data.alternativeTitles)
  assert.equal(Object.hasOwn(result.alternativeTitles[0], 'rowId'), false)
})

test('API errors preserve server status and tokens are supplied by the authentication layer', async () => {
  const originalFetch = globalThis.fetch
  try {
    setAccessTokenProvider(() => 'test-token')
    globalThis.fetch = async (path, options) => {
      assert.equal(path, '/api/authorities/author')
      assert.equal(options.headers.get('Authorization'), 'Bearer test-token')
      return {
        ok: false,
        status: 409,
        json: async () => ({
          error: { code: 'conflict', message: '再取得してください。' },
        }),
      }
    }
    await assert.rejects(
      apiRequest('/api/authorities/author'),
      (error) =>
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === 'conflict',
    )
  } finally {
    globalThis.fetch = originalFetch
    setAccessTokenProvider(undefined)
  }
})
