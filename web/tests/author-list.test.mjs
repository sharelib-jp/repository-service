import assert from 'node:assert/strict'
import test from 'node:test'
import { newAuthority } from '../src/components/AuthorityDialog/authority.ts'
import { filterAuthors } from '../src/components/AuthorList/authorList.ts'

const authors = [
  {
    ...newAuthority('author'),
    id: '01ABC',
    title: '有川, 浩',
    transcription: 'アリカワ ヒロ',
    alternativeTitles: [
      {
        rowId: '1',
        title: '有川, ひろ',
        transcription: 'アリカワ ヒロ',
        language: 'ja',
      },
    ],
    references: [{ rowId: '2', key: 'Wikidata', value: 'Q1059911' }],
  },
  { ...newAuthority('author'), id: '02DEF', title: '別の著者' },
]

test('author search matches ID, titles, readings and references', () => {
  for (const query of [' 01abc ', '有川', 'ｱﾘｶﾜ', 'ひろ', 'q1059911']) {
    assert.deepEqual(filterAuthors(authors, query), [authors[0]])
  }
  assert.deepEqual(filterAuthors(authors, ''), authors)
  assert.deepEqual(filterAuthors(authors, '見つからない'), [])
})
