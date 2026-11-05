import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getBook,
  saveBook,
  deleteBook,
  lookupBookId,
} from '../src/api/books.ts'
import { setCSRFToken, ApiError } from '../src/api/client.ts'
import { listCopies, listAuthors } from '../src/api/catalogLists.ts'
import { loadBookHistory } from '../src/api/bookHistory.ts'

const response = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
})

test('book read/create/update/delete use the actual API paths, CSRF and version preconditions', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  setCSRFToken('csrf-test')
  try {
    globalThis.fetch = async (path, init) => {
      requests.push([path, init])
      if (init.method === 'DELETE') return response(undefined, 204)
      return response({
        ...(init.body ? JSON.parse(init.body) : {}),
        id: 'book-id',
        version: 2,
      })
    }
    const controller = new AbortController()
    await getBook('book-id', controller.signal)
    const created = await saveBook({ title: '本', copies: [] })
    assert.equal(created.id, 'book-id')
    await saveBook({ title: '変更', version: 2 }, created.id)
    await deleteBook(created.id, 3)
    assert.deepEqual(
      requests.map(([path, init]) => [path, init.method ?? 'GET']),
      [
        ['/api/books/book-id', 'GET'],
        ['/api/books', 'POST'],
        ['/api/books/book-id', 'PATCH'],
        ['/api/books/book-id?version=3', 'DELETE'],
      ],
    )
    assert.equal(requests[0][1].signal, controller.signal)
    for (const [, init] of requests.slice(1)) {
      assert.equal(init.credentials, 'same-origin')
      assert.equal(init.headers.get('X-CSRF-Token'), 'csrf-test')
    }
    assert.deepEqual(JSON.parse(requests[2][1].body), {
      title: '変更',
      version: 2,
    })
  } finally {
    globalThis.fetch = originalFetch
    setCSRFToken(undefined)
  }
})

test('book conflicts and duplicate management codes remain visible to callers without retrying writes', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  const data = { title: '未保存', version: 4, reference: { ISBN: 'example' } }
  try {
    globalThis.fetch = async () => {
      calls++
      return response(
        { error: { code: 'conflict', message: '再取得してください。' } },
        409,
      )
    }
    await assert.rejects(
      saveBook(data, 'book'),
      (error) =>
        error instanceof ApiError &&
        error.status === 409 &&
        /再取得/.test(error.message),
    )
    assert.equal(calls, 1)
    assert.equal(data.title, '未保存')
    assert.equal(data.version, 4)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('copy ID lookup distinguishes management codes from ULIDs and only falls back on not-found', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const id = '01JQ4R4KXH7JV2HNMVQ5K0P9WX'
  try {
    globalThis.fetch = async (path) => {
      calls.push(path)
      if (path.startsWith('/api/copies/lookup?'))
        return response({ bookId: 'parent' })
      return response({ error: {} }, 404)
    }
    assert.equal(await lookupBookId(' 管理/001 '), 'parent')
    assert.equal(await lookupBookId(id.toLowerCase()), 'parent')
    assert.equal(calls[1], `/api/copies/${id}`)
    assert.equal(
      new URL(calls[0], 'https://example.com').searchParams.get('code'),
      '管理/001',
    )
    globalThis.fetch = async () => response({ error: {} }, 403)
    await assert.rejects(lookupBookId(id), (error) => error.status === 403)
    globalThis.fetch = async () => response({ error: {} }, 404)
    assert.equal(await lookupBookId('missing'), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('copy list sends server search/pagination and preserves unknown loan history rather than claiming false', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  try {
    globalThis.fetch = async (path, init) => {
      const url = new URL(path, 'https://example.com')
      assert.equal(url.pathname, '/api/copies')
      assert.equal(url.searchParams.get('q'), '書誌')
      assert.equal(url.searchParams.get('condition'), 'lost')
      assert.equal(url.searchParams.get('authorId'), 'local-author')
      assert.equal(url.searchParams.get('page'), '2')
      assert.equal(url.searchParams.get('pageSize'), '20')
      assert.equal(url.searchParams.has('loanHistory'), false)
      assert.equal(init.signal, controller.signal)
      return response({
        items: [
          {
            id: 'copy',
            managementCode: 'A001',
            bibliographicId: 'book',
            title: '書誌',
            author: '著者',
            publisher: '出版社',
            authorIds: ['local-author'],
            condition: 'lost',
            loanPolicy: 'suspended',
            hasLoanHistory: null,
          },
        ],
        total: 23,
        page: 2,
        pageSize: 20,
      })
    }
    const result = await listCopies(
      {
        keyword: ' 書誌 ',
        status: '紛失',
        authorId: 'local-author',
        loanHistory: '',
      },
      2,
      20,
      controller.signal,
    )
    assert.equal(result.total, 23)
    assert.equal(result.items[0].bookId, 'A001')
    assert.equal(result.items[0].bibliographicId, 'book')
    assert.equal(result.items[0].status, '紛失')
    assert.equal(result.items[0].hasLoanHistory, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('author list preserves identity, refs and concurrency timestamp for subsequent editing', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (path) => {
      const url = new URL(path, 'https://example.com')
      assert.equal(url.pathname, '/api/authorities/author')
      assert.equal(url.searchParams.get('q'), '有川')
      assert.equal(url.searchParams.get('page'), '3')
      return response({
        items: [
          {
            id: 'author',
            title: '有川, 浩',
            references: { NDL: '001' },
            updatedAt: '2026-11-05T00:00:00Z',
          },
        ],
        page: 3,
        pageSize: 20,
        total: 41,
      })
    }
    const result = await listAuthors('有川', 3, 20)
    assert.equal(result.items[0].id, 'author')
    assert.equal(result.items[0].references[0].value, '001')
    assert.equal(result.items[0].updatedAt, '2026-11-05T00:00:00Z')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('history search retrieves all pages and deduplicates rows moved by concurrent writes', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  try {
    globalThis.fetch = async (path, init) => {
      const url = new URL(path, 'https://example.com')
      assert.equal(url.pathname, '/api/copies/lookup/history')
      assert.equal(url.searchParams.get('code'), 'A/001')
      assert.equal(init.signal, controller.signal)
      const page = Number(url.searchParams.get('page'))
      return response({
        items:
          page === 1 ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'b' }, { id: 'c' }],
        total: 3,
        pageSize: 2,
        page,
      })
    }
    const entries = await loadBookHistory('A/001', controller.signal)
    assert.deepEqual(
      entries.map((entry) => entry.id),
      ['a', 'b', 'c'],
    )
    assert.ok(entries.every((entry) => entry.bookId === 'A/001'))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('history accepts immutable copy ULIDs for deleted copies and supports ULID-shaped management codes', async () => {
  const originalFetch = globalThis.fetch
  const id = '01JQ4R4KXH7JV2HNMVQ5K0P9WX'
  try {
    let calls = 0
    globalThis.fetch = async (path) => {
      calls++
      if (calls === 1) {
        assert.ok(path.startsWith(`/api/copies/${id}/history?`))
        return response({ error: {} }, 404)
      }
      assert.ok(path.startsWith('/api/copies/lookup/history?'))
      return response({
        items: [{ id: 'history' }],
        total: 1,
        page: 1,
        pageSize: 100,
      })
    }
    assert.equal(
      (await loadBookHistory(id, new AbortController().signal))[0].id,
      'history',
    )
    assert.equal(calls, 2)
    globalThis.fetch = async (path) => {
      assert.ok(path.startsWith(`/api/copies/${id}/history?`))
      return response({
        items: [{ id: 'deleted' }],
        total: 1,
        page: 1,
        pageSize: 100,
      })
    }
    assert.equal(
      (await loadBookHistory(id, new AbortController().signal))[0].id,
      'deleted',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
