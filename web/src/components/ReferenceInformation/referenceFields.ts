import type { SelectionOption } from '../SelectionDialog'

export const DEFAULT_REFERENCE_FIELDS: readonly SelectionOption[] = [
  { label: 'ISBN', value: 'ISBN' },
  { label: '国立国会図書館書誌ID', value: 'NDLBIBID' },
  { label: 'トーハンマークNo', value: 'TOHANMARCNO' },
]

export type AddReferenceFieldResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'invalid-json' | 'not-object' | 'duplicate' }

export function addReferenceField(text: string, key: string): AddReferenceFieldResult {
  if (!text.trim()) {
    return { ok: true, value: `{\n  ${JSON.stringify(key)}: ""\n}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-object' }
  }
  if (Object.hasOwn(parsed, key)) return { ok: false, reason: 'duplicate' }

  const closing = text.lastIndexOf('}')
  const prefix = text.slice(0, closing).trimEnd()
  const comma = Object.keys(parsed).length > 0 ? ',' : ''
  return {
    ok: true,
    value: `${prefix}${comma}\n  ${JSON.stringify(key)}: ""\n${text.slice(closing)}`,
  }
}
