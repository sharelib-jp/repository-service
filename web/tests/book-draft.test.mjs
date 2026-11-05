import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newBookDraft,
  importBookDraft,
  bookDraftFromData,
  bookDataFromDraft,
  publicationDate,
} from '../src/layouts/BookInformationLayout/bookDraft.ts'
import { newAuthority } from '../src/components/AuthorityDialog/authority.ts'
import {
  copyFromShelving,
  shelvingFromCopy,
  shelvingRow,
  emptyShelvingValues,
} from '../src/components/ShelvingList/shelving.ts'

const saved = () => ({
  id: '01JQ4R4KXH7JV2HNMVQ5K0P9WX',
  version: 3,
  title: '本',
  volume: '5.5',
  titleTranscription: 'ホン',
  firstPublishDate: '2024-02',
  firstPublishDatePrecision: 'year_month',
  ndc: '913.6',
  ndcEdition: '10',
  language: 'ja',
  authors: [
    {
      role: '著',
      authority: {
        id: 'local-author',
        title: '有川, 浩',
        updatedAt: '2026-11-04T00:00:00Z',
        type: 'Person',
        references: { Wikidata: 'Q1', nested: { value: 1 } },
      },
    },
  ],
  publisher: {
    id: 'local-publisher',
    title: '出版社',
    type: 'Organization',
    updatedAt: '2026-11-04T00:00:00Z',
  },
  reference: { ISBN: '9784003101018', custom: [1, null] },
  otherAttributes: { materialType: '電子図書', custom: { foo: true } },
  copies: [
    {
      id: 'copy-1',
      version: 4,
      managementCode: 'A001',
      condition: 'normal',
      loanPolicy: 'available',
      deliveredAt: '2026-11-05T12:23:45.123Z',
    },
    {
      id: 'copy-2',
      version: 7,
      managementCode: 'A002',
      condition: 'lost',
      loanPolicy: 'suspended',
      deliveredAt: null,
    },
  ],
})

test('book editing preserves nested data, timestamp precision and optimistic lock versions', () => {
  const book = saved()
  const data = bookDataFromDraft(bookDraftFromData(book))
  assert.equal(data.version, 3)
  assert.equal(data.volume, '5.5')
  assert.equal(data.authorSummary, '有川, 浩 [著]')
  assert.equal(data.authors[0].authorityId, 'local-author')
  assert.equal(
    data.authors[0].authority.updatedAt,
    book.authors[0].authority.updatedAt,
  )
  assert.deepEqual(
    data.authors[0].authority.references,
    book.authors[0].authority.references,
  )
  assert.equal(data.publisherId, 'local-publisher')
  assert.equal(data.publisher.updatedAt, book.publisher.updatedAt)
  assert.equal(data.firstPublishDate, '2024-02')
  assert.equal(data.firstPublishDatePrecision, 'year_month')
  assert.deepEqual(data.reference, book.reference)
  assert.deepEqual(data.otherAttributes, book.otherAttributes)
  assert.deepEqual(data.copies, book.copies)
  assert.deepEqual(data.deletedCopies, [])
  assert.equal(JSON.stringify(data).includes('rowId'), false)
})

test('removing copies sends only the persisted removed IDs and their versions', () => {
  const draft = bookDraftFromData(saved())
  const row = shelvingRow({ ...emptyShelvingValues(), bookId: ' A003 ' })
  draft.copies = [draft.copies[1], row]
  draft.publishers = []
  draft.authors = []
  const data = bookDataFromDraft(draft)
  assert.deepEqual(data.deletedCopies, [{ id: 'copy-1', version: 4 }])
  assert.equal(data.copies[0].id, 'copy-2')
  assert.equal(data.copies[1].managementCode, 'A003')
  assert.equal(data.copies[1].id, undefined)
  assert.equal(data.publisher, null)
  assert.equal(data.publisherId, null)
  assert.deepEqual(data.authors, [])
  assert.equal(data.authorSummary, '')
})

test('new records have no server ID/version and an empty subsequent draft shares no previous edits', () => {
  const draft = newBookDraft()
  draft.title = ' 次の本 '
  draft.authors.push({ ...newAuthority('author'), title: '作者' })
  const data = bookDataFromDraft(draft)
  assert.equal(data.title, '次の本')
  assert.equal(data.version, undefined)
  assert.equal(data.id, undefined)
  assert.equal(data.firstPublishDate, null)
  assert.equal(data.firstPublishDatePrecision, null)
  assert.deepEqual(data.deletedCopies, [])
  const next = newBookDraft()
  assert.equal(next.title, '')
  assert.equal(next.reference, '')
  assert.deepEqual(next.authors, [])
  assert.deepEqual(next.copies, [])
  assert.equal(next.saved, undefined)
})

test('importing selected external data retains copies and supplies volume, structured authors and refs', () => {
  const draft = bookDraftFromData(saved())
  const next = importBookDraft(
    {
      source: 'ndl',
      record: { source: {} },
      data: {
        title: '外部書誌',
        volume: '2',
        firstPublishDate: '2014',
        ndcEdition: '9',
        publisherSummary: '出版社B',
        publisherSummaryTranscription: 'シュッパンシャB',
        authors: [
          { title: '鴨志田, 一', role: '著', references: { NDL: '01234' } },
        ],
        reference: { ISBN: '9784048684637' },
      },
    },
    draft,
  )
  assert.equal(next.saved, draft.saved)
  assert.equal(next.copies, draft.copies)
  assert.equal(next.volume, '2')
  assert.equal(next.authors[0].title, '鴨志田, 一')
  assert.equal(next.authors[0].references[0].value, '01234')
  assert.equal(next.publishers[0].transcription, 'シュッパンシャB')
  assert.deepEqual(bookDataFromDraft(next).reference, { ISBN: '9784048684637' })
})

test('partial and exact publication dates are valid, nonexistent dates are rejected', () => {
  for (const [date, value, precision] of [
    [{ year: '', month: '', day: '' }, null, null],
    [{ year: '2014', month: '', day: '' }, '2014', 'year_only'],
    [{ year: '2014', month: '4', day: '' }, '2014-04', 'year_month'],
    [{ year: '2024', month: '2', day: '29' }, '2024-02-29', 'exact'],
    [{ year: '0096', month: '2', day: '29' }, '0096-02-29', 'exact'],
  ])
    assert.deepEqual(publicationDate(date), { value, precision })
  for (const date of [
    { year: '0000', month: '', day: '' },
    { year: '2014', month: '13', day: '' },
    { year: '', month: '1', day: '' },
    { year: '2023', month: '2', day: '29' },
    { year: '2024', month: '', day: '1' },
    { year: '2024', month: '2', day: '30' },
  ])
    assert.throws(() => publicationDate(date))
})

test('validation rejects incomplete reference rows, malformed JSON, empty title and duplicate management codes', () => {
  assert.throws(() => bookDataFromDraft(newBookDraft()), /タイトル/)
  const draft = { ...newBookDraft(), title: '本' }
  assert.throws(
    () => bookDataFromDraft({ ...draft, referenceValid: false }),
    /参照情報/,
  )
  for (const reference of ['{', '[]', 'null'])
    assert.throws(() => bookDataFromDraft({ ...draft, reference }), /参照情報/)
  assert.throws(
    () => bookDataFromDraft({ ...draft, otherAttributes: '[]' }),
    /その他/,
  )
  assert.throws(
    () => bookDataFromDraft({ ...draft, authors: [newAuthority('author')] }),
    /典拠/,
  )
  const row = shelvingRow({ ...emptyShelvingValues(), bookId: 'A001' })
  assert.throws(
    () =>
      bookDataFromDraft({
        ...draft,
        copies: [row, { ...row, rowId: 'new', bookId: ' A001 ' }],
      }),
    /重複/,
  )
  assert.throws(() => copyFromShelving({ ...row, bookId: '' }), /管理コード/)
  assert.throws(() => copyFromShelving({ ...row, status: 'invalid' }), /状態/)
  assert.throws(
    () => copyFromShelving({ ...row, deliveredAt: '2025-02-30T12:30' }),
    /納入日時/,
  )
})

test('editing delivery date changes its ISO value, while an untouched date retains sub-minute precision', () => {
  const copy = saved().copies[0]
  const row = shelvingFromCopy(copy)
  assert.equal(copyFromShelving(row).deliveredAt, copy.deliveredAt)
  row.deliveredAt = '2026-11-04T10:00'
  assert.equal(
    copyFromShelving(row).deliveredAt,
    new Date(row.deliveredAt).toISOString(),
  )
  row.deliveredAt = ''
  assert.equal(copyFromShelving(row).deliveredAt, null)
})
