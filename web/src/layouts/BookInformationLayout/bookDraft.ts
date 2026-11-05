import type { BookData } from '../../api/books.ts'
import { authorityFromData, authorityToData } from '../../api/authorities.ts'
import type { ExternalBook } from '../../api/externalBooks.ts'
import {
  authoritySummary,
  newAuthority,
  validateAuthorities,
  type Authority,
} from '../../components/AuthorityDialog/authority.ts'
import {
  copyFromShelving,
  shelvingFromCopy,
  type ShelvingRow,
} from '../../components/ShelvingList/shelving.ts'
import { importedAuthors } from './bookImport.ts'

export type BookDraft = {
  saved?: BookData
  title: string
  transcription: string
  volume: string
  materialType: string
  ndc: string
  ndcEdition: string
  language: string
  date: { year: string; month: string; day: string }
  authors: Authority[]
  publishers: Authority[]
  reference: string
  referenceValid: boolean
  otherAttributes: string
  copies: ShelvingRow[]
}

export function newBookDraft(): BookDraft {
  return {
    title: '',
    transcription: '',
    volume: '',
    materialType: '図書',
    ndc: '',
    ndcEdition: '',
    language: 'ja',
    date: { year: '', month: '', day: '' },
    authors: [],
    publishers: [],
    reference: '',
    referenceValid: true,
    otherAttributes: '',
    copies: [],
  }
}
export function bookDraftFromData(book: BookData): BookDraft {
  const [year = '', month = '', day = ''] = (book.firstPublishDate ?? '').split(
    '-',
  )
  const material = book.otherAttributes?.materialType
  return {
    ...newBookDraft(),
    saved: book,
    title: book.title,
    transcription: book.titleTranscription ?? '',
    volume: book.volume ?? '',
    materialType:
      typeof material === 'string'
        ? material
        : Array.isArray(material) && typeof material[0] === 'string'
          ? material[0]
          : '図書',
    ndc: book.ndc ?? '',
    ndcEdition: book.ndcEdition ?? '',
    language: book.language ?? '',
    date: { year, month, day },
    authors: (book.authors ?? []).map((link) => ({
      ...authorityFromData(
        link.authority ?? { id: link.authorityId, title: book.authorSummary },
        'author',
        true,
      ),
      role: link.role,
    })),
    publishers: book.publisher
      ? [authorityFromData(book.publisher, 'publisher', true)]
      : [],
    reference: JSON.stringify(book.reference ?? {}, null, 2),
    otherAttributes: JSON.stringify(book.otherAttributes ?? {}, null, 2),
    copies: (book.copies ?? []).map(shelvingFromCopy),
  }
}
export function importBookDraft(
  book: ExternalBook,
  current: BookDraft,
): BookDraft {
  const [year = '', month = '', day = ''] = (
    book.data.firstPublishDate ?? ''
  ).split('-')
  const publisher = newAuthority('publisher')
  publisher.title = book.data.publisherSummary ?? ''
  publisher.transcription = book.data.publisherSummaryTranscription ?? ''
  return {
    ...current,
    title: book.data.title ?? '',
    transcription: book.data.titleTranscription ?? '',
    volume: book.data.volume ?? '',
    ndc: book.data.ndc ?? '',
    ndcEdition: book.data.ndcEdition ?? '',
    language: book.data.language ?? current.language,
    date: { year, month, day },
    authors: importedAuthors(book),
    publishers: publisher.title ? [publisher] : [],
    reference: JSON.stringify(book.data.reference ?? {}, null, 2),
    referenceValid: true,
  }
}
function objectJSON(text: string, label: string): Record<string, unknown> {
  if (!text.trim()) return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${label}の JSON 形式を確認してください。`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}は JSON オブジェクトで入力してください。`)
  return value as Record<string, unknown>
}
export function publicationDate(date: BookDraft['date']): {
  value: string | null
  precision: string | null
} {
  const { year, month, day } = date
  if (!year && !month && !day) return { value: null, precision: null }
  if (!/^\d{4}$/.test(year) || year === '0000' || (day && !month))
    throw new Error('出版年・月・日の入力を確認してください。')
  if (!month) return { value: year, precision: 'year_only' }
  if (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12)
    throw new Error('出版月を確認してください。')
  const value = `${year}-${month.padStart(2, '0')}`
  if (!day) return { value, precision: 'year_month' }
  const check = new Date(0)
  check.setUTCFullYear(Number(year), Number(month) - 1, Number(day))
  if (
    !/^\d{1,2}$/.test(day) ||
    Number(day) < 1 ||
    check.getUTCFullYear() !== Number(year) ||
    check.getUTCMonth() !== Number(month) - 1 ||
    check.getUTCDate() !== Number(day)
  )
    throw new Error('出版日を確認してください。')
  return { value: `${value}-${day.padStart(2, '0')}`, precision: 'exact' }
}
export function bookDataFromDraft(draft: BookDraft): BookData {
  if (!draft.title.trim()) throw new Error('タイトルを入力してください。')
  if (!draft.referenceValid)
    throw new Error('参照情報の未入力・重複・JSON 形式を確認してください。')
  const problem =
    validateAuthorities(draft.authors, 'author') ??
    validateAuthorities(draft.publishers, 'publisher')
  if (problem) throw new Error(problem)
  const reference = objectJSON(draft.reference, '参照情報')
  const otherAttributes = objectJSON(draft.otherAttributes, 'その他の属性情報')
  const date = publicationDate(draft.date)
  const codes = new Set<string>()
  const copies = draft.copies.map((row) => {
    const copy = copyFromShelving(row)
    if (codes.has(copy.managementCode))
      throw new Error('配架情報の書籍 ID（管理コード）が重複しています。')
    codes.add(copy.managementCode)
    return copy
  })
  const deletedCopies = (draft.saved?.copies ?? [])
    .filter((copy) => copy.id && !copies.some((row) => row.id === copy.id))
    .map((copy) => ({ id: copy.id!, version: copy.version! }))
  return {
    version: draft.saved?.version,
    title: draft.title.trim(),
    titleTranscription: draft.transcription,
    volume: draft.volume,
    authorSummary: authoritySummary(draft.authors, 'author'),
    authorSummaryTranscription: authoritySummary(draft.authors, 'author', true),
    publisherId: draft.publishers[0]?.id || null,
    publisher: draft.publishers[0]
      ? authorityToData(draft.publishers[0])
      : null,
    publisherSummary: authoritySummary(draft.publishers, 'publisher'),
    publisherSummaryTranscription: authoritySummary(
      draft.publishers,
      'publisher',
      true,
    ),
    firstPublishDate: date.value,
    firstPublishDatePrecision: date.precision,
    ndc: draft.ndc,
    ndcEdition: draft.ndcEdition,
    language: draft.language,
    authors: draft.authors.map((author, index) => ({
      authorityId: author.id || undefined,
      authority: authorityToData(author),
      role: author.role,
      position: index + 1,
    })),
    reference,
    otherAttributes: { ...otherAttributes, materialType: draft.materialType },
    copies,
    deletedCopies,
  }
}
