import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorityFromCandidate,
  authoritySummary,
  newAuthority,
  validateAuthorities,
} from '../src/components/AuthorityDialog/authority.ts'
import { searchWikidata } from '../src/components/AuthorityDialog/wikidata.ts'

test('Wikidata results become drafts with a reference, never a local authority ID', () => {
  const author = authorityFromCandidate(
    { source: 'wikidata', id: 'Q1059911', title: '有川, 浩' },
    'author',
  )
  assert.equal(author.id, '')
  assert.equal(author.type, 'Other')
  assert.equal(author.role, '著')
  assert.deepEqual(
    author.references.map(({ key, value }) => ({ key, value })),
    [{ key: 'Wikidata', value: 'Q1059911' }],
  )
  assert.equal(authoritySummary([author], 'author'), '有川, 浩 [著]')
  assert.equal(authoritySummary([author], 'author', true), '')
  assert.equal(validateAuthorities([author], 'author'), null)
})

test('library candidates preserve ID and edit independently of the source', () => {
  const source = {
    ...newAuthority('author'),
    id: '01EXAMPLE',
    title: '著者',
    role: '絵',
    references: [{ rowId: '1', key: 'NDL', value: '123' }],
  }
  const copy = authorityFromCandidate(
    {
      source: 'library',
      id: source.id,
      title: source.title,
      authority: source,
    },
    'author',
  )
  assert.equal(copy.id, source.id)
  assert.equal(copy.role, '著')
  assert.notEqual(copy.rowId, source.rowId)
  copy.references[0].value = 'changed'
  assert.equal(source.references[0].value, '123')
})

test('titles, dates, duplicate references and publisher cardinality are validated', () => {
  const author = {
    ...newAuthority('author'),
    title: '著者',
    type: 'Person',
    birthDate: '2000-02-29',
    birthDatePrecision: 'exact',
  }
  assert.equal(validateAuthorities([author], 'author'), null)
  assert.match(
    validateAuthorities([{ ...author, birthDate: '2001-02-29' }], 'author'),
    /日付/,
  )
  assert.match(
    validateAuthorities(
      [{ ...author, birthDate: '2000', birthDatePrecision: '' }],
      'author',
    ),
    /日付/,
  )
  assert.match(
    validateAuthorities([{ ...author, type: 'Organization' }], 'author'),
    /生年月日/,
  )
  assert.match(
    validateAuthorities([{ ...author, title: '' }], 'author'),
    /タイトル/,
  )
  const references = [
    { rowId: '1', key: 'NDL', value: '1' },
    { rowId: '2', key: 'NDL', value: '2' },
  ]
  assert.match(
    validateAuthorities([{ ...author, references }], 'author'),
    /重複/,
  )
  assert.match(
    validateAuthorities([author, { ...author, rowId: 'other' }], 'publisher'),
    /１件/,
  )
})

test('external authority search uses the repository mapping API', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  try {
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url, 'http://localhost')
      assert.equal(parsed.pathname, '/api/external/authorities')
      assert.equal(parsed.searchParams.get('source'), 'wikidata')
      assert.equal(parsed.searchParams.get('q[keyword]'), '有川浩')
      assert.equal(options.signal, controller.signal)
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              source: 'wikidata',
              record: { source: { record_id: 'Q1059911' } },
              data: {
                title: '有川, 浩',
                references: { CustomLibraryId: 'Q1059911' },
              },
            },
          ],
        }),
      }
    }
    const result = await searchWikidata('有川 浩', 'author', controller.signal)
    assert.equal(result[0].source, 'external')
    assert.equal(result[0].authority.id, '')
    assert.equal(result[0].authority.references[0].key, 'CustomLibraryId')
    assert.equal(result[0].authority.references[0].value, 'Q1059911')
  } finally {
    globalThis.fetch = originalFetch
  }
})
