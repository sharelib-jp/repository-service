/** Keep names without an explicit boundary intact; a family name cannot be inferred safely. */
export function authorityName(value: string): string {
  const name = value.trim().replace(/\s*[,，]\s*/g, ', ')
  if (name.includes(',')) return name
  const parts = name.split(/[\s　]+/).filter(Boolean)
  return parts.length === 2 ? `${parts[0]}, ${parts[1]}` : name
}

export function wikidataNameQuery(value: string): string {
  return value.replace(/[,，\s　]+/g, '')
}
