import assert from 'node:assert/strict'
import test from 'node:test'
import { filterBooks } from '../src/components/BookList/bookList.ts'

const books = [
  {
    bookId: 'A001',
    title: '図書館の本',
    author: '山田',
    authorIds: ['author-1', 'author-2'],
    publisher: '青出版',
    status: '問題なし',
    hasLoanHistory: true,
  },
  {
    bookId: 'B002',
    title: '別の本',
    author: '佐藤',
    authorIds: ['author-3'],
    publisher: '赤出版',
    status: '紛失',
    hasLoanHistory: false,
  },
]
const search = { keyword: '', status: '', loanHistory: '' }

test('search matches ID, title, author and publisher without case or surrounding spaces', () => {
  for (const keyword of [' a001 ', '図書館', '山田', '青出版']) {
    assert.deepEqual(filterBooks(books, { ...search, keyword }), [books[0]])
  }
})

test('author authority filter matches IDs rather than display names and combines with other criteria', () => {
  const namesake = { ...books[1], author: '山田', authorIds: ['author-4'] }
  assert.deepEqual(
    filterBooks([...books, namesake], { ...search, authorId: 'author-1' }),
    [books[0]],
  )
  assert.deepEqual(
    filterBooks(books, { ...search, authorId: 'author-2', status: '紛失' }),
    [],
  )
  assert.deepEqual(filterBooks(books, { ...search, authorId: 'missing' }), [])
  assert.deepEqual(
    filterBooks([books[0], { ...books[1], authorIds: undefined }], {
      ...search,
      authorId: 'author-1',
    }),
    [books[0]],
  )
})

test('detail criteria combine with keywords and distinguish loan history', () => {
  assert.deepEqual(
    filterBooks(books, { keyword: '本', status: '紛失', loanHistory: 'no' }),
    [books[1]],
  )
  assert.deepEqual(
    filterBooks(books, { keyword: '本', status: '紛失', loanHistory: 'yes' }),
    [],
  )
  assert.deepEqual(filterBooks(books, search), books)
})
