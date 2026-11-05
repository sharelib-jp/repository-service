import assert from 'node:assert/strict'
import test from 'node:test'
import { newAuthority } from '../src/components/AuthorityDialog/authority.ts'
import {
  reuseLibraryAuthority,
  resolveBookAuthorities,
  wikidataID,
} from '../src/api/authorityResolution.ts'
import { listAuthorities } from '../src/api/catalogLists.ts'
import { saveAuthority } from '../src/api/authorities.ts'
import { filterAuthorities } from '../src/components/AuthorityList/authorityList.ts'

const response = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
})
const library = {
  id: 'local-id',
  title: '館内表記',
  transcription: 'カンナイヨミ',
  language: 'ja',
  type: 'Person',
  updatedAt: '2026-11-05T00:00:00Z',
  references: { Wikidata: 'Q12', Local: 'kept' },
}

test('library match preserves its content and concurrency timestamp, retaining only the book relationship role/row', async () => {
  const originalFetch = globalThis.fetch
  const row = {
    ...newAuthority('author'),
    title: '外部表記',
    role: '絵',
    references: [{ rowId: 'external', key: 'Wikidata', value: 'Q12' }],
  }
  const controller = new AbortController()
  try {
    globalThis.fetch = async (path, init) => {
      const url = new URL(path, 'https://example.com')
      assert.equal(url.pathname, '/api/authorities/author/match')
      assert.equal(url.searchParams.get('title'), '外部表記')
      assert.equal(url.searchParams.get('wikidata'), 'Q12')
      assert.equal(init.signal, controller.signal)
      assert.equal(init.credentials, 'same-origin')
      return response({ item: library })
    }
    const resolved = await reuseLibraryAuthority(
      row,
      'author',
      controller.signal,
    )
    assert.equal(resolved.id, library.id)
    assert.equal(resolved.title, library.title)
    assert.equal(resolved.transcription, library.transcription)
    assert.equal(resolved.updatedAt, library.updatedAt)
    assert.equal(resolved.rowId, row.rowId)
    assert.equal(resolved.role, '絵')
    assert.deepEqual(
      resolved.references.map(({ key, value }) => [key, value]),
      [
        ['Wikidata', 'Q12'],
        ['Local', 'kept'],
      ],
    )
    assert.equal(row.id, '')
    assert.equal(row.title, '外部表記')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('exact local titles are resolved for both authors and publishers before requesting Wikidata', async () => {
  const originalFetch = globalThis.fetch
  const author = { ...newAuthority('author'), title: '館内著者' }
  const publisher = { ...newAuthority('publisher'), title: '館内出版社' }
  const calls = []
  try {
    globalThis.fetch = async (path) => {
      const url = new URL(path, 'https://example.com')
      calls.push(url.pathname)
      assert.ok(url.pathname.endsWith('/match'))
      const isPublisher = url.pathname.includes('/publisher/')
      return response({
        item: {
          ...library,
          id: isPublisher ? 'publisher' : 'author',
          title: url.searchParams.get('title'),
          type: isPublisher ? 'Organization' : 'Person',
        },
      })
    }
    const result = await resolveBookAuthorities(
      [author],
      [publisher],
      new AbortController().signal,
    )
    assert.deepEqual(calls.sort(), [
      '/api/authorities/author/match',
      '/api/authorities/publisher/match',
    ])
    assert.equal(result.authors[0].id, 'author')
    assert.equal(result.publishers[0].id, 'publisher')
    assert.deepEqual(result.issues, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('after no title match, Wikidata first result is used to find the local authority by Q ID', async () => {
  const originalFetch = globalThis.fetch
  const row = { ...newAuthority('author'), title: '有川, 浩', role: '著' }
  const paths = []
  try {
    globalThis.fetch = async (path) => {
      const url = new URL(path, 'https://example.com')
      paths.push(url.pathname)
      if (url.pathname.endsWith('/match')) {
        assert.equal(url.searchParams.get('title'), '有川, 浩')
        return response({
          item:
            url.searchParams.get('wikidata') === 'Q12'
              ? { ...library, title: '有川, ひろ' }
              : null,
        })
      }
      if (url.pathname === '/api/external/sources')
        return response({
          items: [{ name: 'wikidata', queryFields: ['keyword'] }],
        })
      assert.equal(url.pathname, '/api/external/authorities')
      assert.equal(url.searchParams.get('q[keyword]'), '有川浩')
      return response({
        items: [
          {
            record: { source: { record_id: 'Q12' } },
            data: { title: '有川ひろ', references: { Wikidata: 'Q12' } },
          },
        ],
      })
    }
    const result = await resolveBookAuthorities(
      [row],
      [],
      new AbortController().signal,
    )
    assert.deepEqual(paths, [
      '/api/authorities/author/match',
      '/api/external/sources',
      '/api/external/authorities',
      '/api/authorities/author/match',
    ])
    assert.equal(result.authors[0].id, 'local-id')
    assert.equal(result.authors[0].title, '有川, ひろ')
    assert.equal(result.authors[0].role, '著')
    assert.deepEqual(result.issues, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('unmatched imported Q IDs stay new, explicit local IDs are untouched, ambiguous matches are reported', async () => {
  const originalFetch = globalThis.fetch
  const row = {
    ...newAuthority('author'),
    title: '外部著者',
    references: [{ rowId: 'q', key: 'wikidata', value: 'Q123' }],
  }
  try {
    globalThis.fetch = async (path) => {
      assert.ok(path.startsWith('/api/authorities/author/match?'))
      return response({ item: null })
    }
    assert.equal(
      (await resolveBookAuthorities([row], [], new AbortController().signal))
        .authors[0],
      row,
    )
    const existing = { ...row, id: 'local' }
    globalThis.fetch = async () => {
      throw new Error('must not fetch')
    }
    assert.equal(await reuseLibraryAuthority(existing, 'author'), existing)
    globalThis.fetch = async () =>
      response(
        {
          error: {
            code: 'ambiguous_authority',
            message: '館内検索から選択してください。',
          },
        },
        409,
      )
    await assert.rejects(
      reuseLibraryAuthority(row, 'author'),
      (error) => error.code === 'ambiguous_authority',
    )
    const result = await resolveBookAuthorities(
      [row],
      [],
      new AbortController().signal,
    )
    assert.equal(result.authors[0], row)
    assert.match(result.issues[0], /館内検索/)
    assert.equal(
      wikidataID({ ...row, references: [{ key: 'Wikidata', value: 'Q12x' }] }),
      '',
    )
    assert.equal(
      wikidataID({ ...row, references: [{ key: 'NDL', value: 'Q12' }] }),
      '',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('publisher list and edit use publisher endpoints and retain organization titles without person-name formatting', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async (path, init) => {
      calls.push([path, init.method ?? 'GET'])
      if (init.method === 'PATCH') {
        const data = JSON.parse(init.body)
        assert.equal(data.id, 'publisher')
        assert.equal(data.updatedAt, library.updatedAt)
        assert.equal(data.title, 'New Publisher')
        return response({ ...data, updatedAt: '2026-11-05T01:00:00Z' })
      }
      const url = new URL(path, 'https://example.com')
      assert.equal(url.pathname, '/api/authorities/publisher')
      assert.equal(url.searchParams.get('q'), 'Publisher')
      assert.equal(url.searchParams.get('page'), '2')
      return response({
        items: [
          {
            ...library,
            id: 'publisher',
            title: 'Example Publisher',
            type: 'Organization',
          },
        ],
        page: 2,
        pageSize: 20,
        total: 21,
      })
    }
    const result = await listAuthorities('publisher', 'Publisher', 2, 20)
    assert.equal(result.items[0].title, 'Example Publisher')
    assert.equal(filterAuthorities(result.items, 'q12').length, 1)
    const updated = await saveAuthority(
      { ...result.items[0], title: 'New Publisher' },
      'publisher',
    )
    assert.equal(updated.updatedAt, '2026-11-05T01:00:00Z')
    assert.equal(calls[1][0], '/api/authorities/publisher/publisher')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('publisher Wikidata fallback keeps spaces in organization names and reuses the local Q-ID match', async () => {
  const originalFetch = globalThis.fetch
  const publisher = {
    ...newAuthority('publisher'),
    title: 'Oxford University Press',
    transcription: 'オックスフォード',
    references: [{ rowId: 'ndl', key: 'NDL', value: '001' }],
  }
  const paths = []
  const controller = new AbortController()
  try {
    globalThis.fetch = async (path, init) => {
      assert.equal(init.signal, controller.signal)
      const url = new URL(path, 'https://example.com')
      paths.push(url.pathname)
      if (url.pathname.endsWith('/match')) {
        assert.equal(url.pathname, '/api/authorities/publisher/match')
        assert.equal(url.searchParams.get('title'), publisher.title)
        return response({
          item:
            url.searchParams.get('wikidata') === 'Q123'
              ? {
                  ...library,
                  id: 'local-publisher',
                  title: '館内出版社',
                  type: 'Organization',
                  references: { Wikidata: 'Q123', Local: 'kept' },
                }
              : null,
        })
      }
      if (url.pathname === '/api/external/sources')
        return response({
          items: [{ name: 'wikidata', queryFields: ['keyword'] }],
        })
      assert.equal(url.pathname, '/api/external/authorities')
      assert.equal(url.searchParams.get('q[keyword]'), publisher.title)
      return response({
        items: [
          {
            record: { source: { record_id: 'Q123' } },
            data: {
              title: 'Oxford University Press',
              references: { Wikidata: 'Q123' },
            },
          },
          {
            record: { source: { record_id: 'Q999' } },
            data: { title: 'Other result', references: { Wikidata: 'Q999' } },
          },
        ],
      })
    }
    const result = await resolveBookAuthorities(
      [],
      [publisher],
      controller.signal,
    )
    assert.deepEqual(paths, [
      '/api/authorities/publisher/match',
      '/api/external/sources',
      '/api/external/authorities',
      '/api/authorities/publisher/match',
    ])
    const resolved = result.publishers[0]
    assert.equal(resolved.id, 'local-publisher')
    assert.equal(resolved.title, '館内出版社')
    assert.equal(resolved.transcription, library.transcription)
    assert.equal(resolved.updatedAt, library.updatedAt)
    assert.equal(resolved.rowId, publisher.rowId)
    assert.equal(resolved.type, 'Organization')
    assert.deepEqual(
      resolved.references.map(({ key, value }) => [key, value]),
      [
        ['Wikidata', 'Q123'],
        ['Local', 'kept'],
      ],
    )
    assert.deepEqual(result.issues, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('author and publisher imports share source discovery and keep unmatched Wikidata references as new drafts', async () => {
  const originalFetch = globalThis.fetch
  let sourceRequests = 0
  try {
    globalThis.fetch = async (path) => {
      const url = new URL(path, 'https://example.com')
      if (url.pathname.endsWith('/match')) return response({ item: null })
      if (url.pathname === '/api/external/sources') {
        sourceRequests++
        return response({
          items: [{ name: 'wikidata', queryFields: ['keyword'] }],
        })
      }
      const query = url.searchParams.get('q[keyword]')
      assert.ok(['有川浩', 'Example Publisher'].includes(query))
      const qid = query === '有川浩' ? 'Q1' : 'Q2'
      return response({
        items: [
          {
            record: { source: { record_id: qid } },
            data: { title: query, references: { Wikidata: qid } },
          },
        ],
      })
    }
    const result = await resolveBookAuthorities(
      [{ ...newAuthority('author'), title: '有川, 浩' }],
      [
        {
          ...newAuthority('publisher'),
          title: 'Example Publisher',
          transcription: 'カンナイヨミ',
        },
      ],
      new AbortController().signal,
    )
    assert.equal(sourceRequests, 1)
    assert.equal(result.authors[0].id, '')
    assert.equal(wikidataID(result.authors[0]), 'Q1')
    assert.equal(result.publishers[0].id, '')
    assert.equal(wikidataID(result.publishers[0]), 'Q2')
    assert.equal(result.publishers[0].title, 'Example Publisher')
    assert.equal(result.publishers[0].transcription, 'カンナイヨミ')
    assert.deepEqual(result.issues, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
