export type ReferenceRow = {
  id: number
  name: string
  value: string
  jsonValue: boolean
}

export type ParsedReferences =
  | { ok: true; entries: [string, unknown][] }
  | { ok: false; reason: 'invalid-json' | 'not-object' }

export function parseReferences(text: string): ParsedReferences {
  if (!text.trim()) return { ok: true, entries: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-object' }
  }
  return { ok: true, entries: Object.entries(parsed) }
}

export function rowFromEntry(id: number, name: string, value: unknown): ReferenceRow {
  return {
    id,
    name,
    value: typeof value === 'string' ? value : JSON.stringify(value),
    jsonValue: typeof value !== 'string',
  }
}

export type SerializedReferences =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty-name' | 'duplicate' | 'invalid-value' }

export function serializeReferences(rows: readonly ReferenceRow[]): SerializedReferences {
  const names = new Set<string>()
  const entries: [string, unknown][] = []
  for (const row of rows) {
    if (!row.name.trim()) return { ok: false, reason: 'empty-name' }
    if (names.has(row.name)) return { ok: false, reason: 'duplicate' }
    names.add(row.name)
    let value: unknown = row.value
    if (row.jsonValue) {
      try {
        value = JSON.parse(row.value)
      } catch {
        return { ok: false, reason: 'invalid-value' }
      }
    }
    entries.push([row.name, value])
  }
  return { ok: true, value: JSON.stringify(Object.fromEntries(entries), null, 2) }
}
