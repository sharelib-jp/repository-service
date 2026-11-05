import test from 'node:test'
import assert from 'node:assert/strict'
import {
  searchExternalBooks,
  externalBookDetails,
} from '../src/api/externalBooks.ts'
import { importedAuthors } from '../src/layouts/BookInformationLayout/bookImport.ts'

test('external book search sends source, field, query and page', async () => {
  const previous = globalThis.fetch
  try {
    globalThis.fetch = async (path, options) => {
      const url = new URL(path, 'https://test.example')
      assert.equal(url.pathname, '/api/external/books')
      assert.equal(url.searchParams.get('source'), 'ndl')
      assert.equal(url.searchParams.get('q[isbn]'), '9784003101018')
      assert.equal(url.searchParams.get('page'), '2')
      assert.equal(options.credentials, 'same-origin')
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ data: { title: '本' } }] }),
      }
    }
    const result = await searchExternalBooks(
      'ndl',
      'isbn',
      '9784003101018',
      2,
      new AbortController().signal,
    )
    assert.equal(result[0].data.title, '本')
  } finally {
    globalThis.fetch = previous
  }
})

test('creates author drafts from creator fields, preserving roles and order', () => {
  const authors = importedAuthors({
    record: {
      source: {},
      fields: {
        creator: [{ value: '夏目 漱石 著' }, { value: '山田 太郎 訳' }],
      },
    },
    data: {},
  })
  assert.deepEqual(
    authors.map(({ title, role }) => ({ title, role })),
    [
      { title: '夏目, 漱石', role: '著' },
      { title: '山田, 太郎', role: '訳' },
    ],
  )
  assert.notEqual(authors[0].rowId, authors[1].rowId)
})

test('uses projected author summary when original creator fields are absent', () => {
  const authors = importedAuthors({
    record: { source: {}, fields: { creator: [] } },
    data: { authorSummary: '著者A 著 ; 著者B 編' },
  })
  assert.deepEqual(
    authors.map(({ title, role }) => ({ title, role })),
    [
      { title: '著者A', role: '著' },
      { title: '著者B', role: '編' },
    ],
  )
})

test('fetches only a selected provider identifier using the authenticated API', async () => {
  const previous = globalThis.fetch
  const controller = new AbortController()
  try {
    globalThis.fetch = async (path, options) => {
      assert.equal(path, '/api/external/books/ndl/R100000002-I025363549')
      assert.equal(options.signal, controller.signal)
      assert.equal(options.credentials, 'same-origin')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          source: 'ndl',
          data: { title: '詳細' },
          record: { source: {} },
        }),
      }
    }
    const result = await externalBookDetails(
      'ndl',
      'R100000002-I025363549',
      controller.signal,
    )
    assert.equal(result.data.title, '詳細')
  } finally {
    globalThis.fetch = previous
  }
})
