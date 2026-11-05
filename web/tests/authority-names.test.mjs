import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorityName,
  wikidataNameQuery,
} from '../src/components/AuthorityDialog/names.ts'
import {
  authoritySummary,
  newAuthority,
} from '../src/components/AuthorityDialog/authority.ts'
import { importedAuthors } from '../src/layouts/BookInformationLayout/bookImport.ts'

test('NCR style keeps explicit family and given names, roles and order', () => {
  const a = { ...newAuthority('author'), title: '有川　浩', role: '著' }
  const b = { ...newAuthority('author'), title: '徒花,スクモ', role: '絵' }
  assert.equal(
    authoritySummary([a, b], 'author'),
    '有川, 浩 [著]; 徒花, スクモ [絵]',
  )
  assert.equal(authorityName('鴨志田一'), '鴨志田一')
  assert.equal(wikidataNameQuery('有川, 浩'), '有川浩')
})
test('structured external authors keep reading, role, and identifiers', () => {
  const rows = importedAuthors({
    record: { source: {} },
    data: {
      authors: [
        {
          title: '溝口, ケージ',
          transcription: 'ミゾグチ, ケージ',
          role: '絵',
          references: { CiNiiAuthorID: 'DA1' },
        },
      ],
    },
  })
  assert.equal(rows[0].title, '溝口, ケージ')
  assert.equal(rows[0].transcription, 'ミゾグチ, ケージ')
  assert.equal(rows[0].role, '絵')
  assert.equal(rows[0].references[0].value, 'DA1')
})

test('publisher summaries preserve organization names and readings without person-name commas or roles', () => {
  const publisher = {
    ...newAuthority('publisher'),
    title: ' Example Publisher ',
    transcription: ' エグザンプル パブリッシャー ',
    role: '著',
  }
  assert.equal(authoritySummary([publisher], 'publisher'), 'Example Publisher')
  assert.equal(
    authoritySummary([publisher], 'publisher', true),
    'エグザンプル パブリッシャー',
  )
})
