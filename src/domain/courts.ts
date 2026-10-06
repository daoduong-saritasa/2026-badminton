export type CourtNameIssue = 'empty' | 'too-long' | 'duplicate'

/** Longest court name the database accepts, after trimming. */
export const courtNameMaxLength = 30

/**
 * Problems with a pair of court names, checked the way the database checks
 * them: trimmed, 1 to 30 characters each, and different ignoring case.
 */
export function courtNameIssues(names: readonly [string, string]): CourtNameIssue[] {
  const trimmed = names.map((name) => name.trim())
  const issues: CourtNameIssue[] = []
  if (trimmed.some((name) => name.length === 0)) issues.push('empty')
  if (trimmed.some((name) => name.length > courtNameMaxLength)) issues.push('too-long')
  if (trimmed[0] !== '' && trimmed[0].toLocaleLowerCase('vi') === trimmed[1].toLocaleLowerCase('vi')) issues.push('duplicate')
  return issues
}
