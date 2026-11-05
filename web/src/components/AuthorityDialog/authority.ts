import { authorityName } from './names.ts'

export type AuthorityKind = 'author' | 'publisher'
export type AuthorityType = 'Person' | 'Organization' | 'Other'
export type DatePrecision = '' | 'year_only' | 'year_month' | 'exact'

export type AuthorityReference = {
  key: string
  value: string
  rowId: string
  jsonValue?: boolean
}
export type AlternativeTitle = {
  title: string
  transcription: string
  language: string
  rowId: string
}

export type Authority = {
  rowId: string
  id: string
  title: string
  transcription: string
  language: string
  type: AuthorityType
  role: string
  updatedAt?: string
  createdAt?: string
  alternativeTitles: AlternativeTitle[]
  birthDate: string
  birthDatePrecision: DatePrecision
  foundationDate: string
  foundationDatePrecision: DatePrecision
  references: AuthorityReference[]
}

export type AuthorityCandidate = {
  source: 'wikidata' | 'library' | 'external'
  sourceName?: string
  id: string
  title: string
  description?: string
  authority?: Authority
}

export type AuthoritySearch = (
  query: string,
  kind: AuthorityKind,
  signal: AbortSignal,
) => Promise<AuthorityCandidate[]>

let nextDraftId = 0
export function draftId(): string {
  nextDraftId += 1
  return `authority-draft-${nextDraftId}`
}

export function newAuthority(kind: AuthorityKind): Authority {
  return {
    rowId: draftId(),
    id: '',
    title: '',
    transcription: '',
    language: 'ja',
    type: 'Other',
    role: kind === 'author' ? '著' : '',
    alternativeTitles: [],
    birthDate: '',
    birthDatePrecision: '',
    foundationDate: '',
    foundationDatePrecision: '',
    references: [],
  }
}

export function authorityFromCandidate(
  candidate: AuthorityCandidate,
  kind: AuthorityKind,
): Authority {
  if (candidate.authority) {
    return {
      ...structuredClone(candidate.authority),
      id: candidate.source === 'library' ? candidate.authority.id : '',
      rowId: draftId(),
      role: kind === 'author' ? '著' : '',
    }
  }
  const authority = newAuthority(kind)
  authority.title =
    kind === 'author' ? authorityName(candidate.title) : candidate.title
  if (candidate.source === 'library') authority.id = candidate.id
  if (candidate.source === 'wikidata') {
    authority.references = [
      { rowId: draftId(), key: 'Wikidata', value: candidate.id },
    ]
  }
  return authority
}

function validDate(value: string, precision: DatePrecision): boolean {
  if (!value && !precision) return true
  if (precision === 'year_only')
    return /^\d{4}$/.test(value) && value !== '0000'
  if (precision === 'year_month' && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number)
    return year > 0 && month >= 1 && month <= 12
  }
  if (precision === 'exact' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(0)
    date.setUTCFullYear(year, month - 1, day)
    return (
      year > 0 &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    )
  }
  return false
}

export function validateAuthorities(
  rows: readonly Authority[],
  kind: AuthorityKind,
): string | null {
  if (kind === 'publisher' && rows.length > 1)
    return '出版社は１件を選択してください。'
  const authorityIds = new Set<string>()
  for (const row of rows) {
    if (!row.title.trim()) return 'すべての典拠にタイトルを入力してください。'
    if (row.alternativeTitles.some((title) => !title.title.trim()))
      return '別名のタイトルを入力してください。'
    if (row.id && authorityIds.has(row.id))
      return '同じ典拠が複数選択されています。'
    if (row.id) authorityIds.add(row.id)
    if (row.type === 'Organization' && row.birthDate)
      return '団体の生年月日は入力できません。'
    if (row.type === 'Person' && row.foundationDate)
      return '人物の設立日は入力できません。'
    if (
      !validDate(row.birthDate, row.birthDatePrecision) ||
      !validDate(row.foundationDate, row.foundationDatePrecision)
    ) {
      return '日付と精度を確認してください。'
    }
    const keys = new Set<string>()
    for (const reference of row.references) {
      if (reference.jsonValue) {
        try {
          JSON.parse(reference.value)
        } catch {
          return 'JSON 形式の参照値を確認してください。'
        }
      }
      if (!reference.key.trim()) return '参照情報の項目名を入力してください。'
      if (keys.has(reference.key)) return '参照情報の項目名が重複しています。'
      keys.add(reference.key)
    }
  }
  return null
}

export function authoritySummary(
  rows: readonly Authority[],
  kind: AuthorityKind,
  transcription = false,
): string {
  return rows
    .map((row) => {
      const value = transcription ? row.transcription : row.title
      const name = kind === 'author' ? authorityName(value) : value.trim()
      if (!name) return ''
      return kind === 'author' && row.role.trim()
        ? `${name} [${row.role.trim()}]`
        : name
    })
    .filter(Boolean)
    .join('; ')
}
