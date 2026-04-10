/**
 * Key insights (`crmFull`) must be context only — interest, risks, opportunities.
 * Drop any line that reads like a next-step / task (action language).
 */

/** English (user list) + Spanish parallels + "meet" as verb distinct from "meeting". */
const ACTION_LANGUAGE_PATTERNS: RegExp[] = [
  /\bsend\b/i,
  /\bcall\b/i,
  /\bfollow\s*[-]?\s*up\b/i,
  /\bmeeting\b/i,
  /\bmeet\b/i,
  /\benviar\b/i,
  /\bllamar\b/i,
  /\bseguimiento\b/i,
  /\bdar\s+seguimiento\b/i,
  /\breuni[oó]n\b/i,
  /\breunir(?:se)?\b/i,
]

/** True if this insight line should be removed (contains task/action wording). */
export function insightLineContainsActionLanguage(line: string): boolean {
  const t = line.replace(/\s+/g, ' ').trim()
  if (!t) return true
  return ACTION_LANGUAGE_PATTERNS.some((re) => re.test(t))
}

/** Keep only context-style insight lines; preserves order. */
export function filterInsightsToContextOnly(lines: string[]): string[] {
  return lines
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !insightLineContainsActionLanguage(l))
}

/**
 * Calendar body lines should be recallable days later — skip generic CRM fluff (EN + ES).
 * Used when picking crmFull for event description; does not affect on-screen insights list.
 */
const VAGUE_CALENDAR_DESCRIPTION_PATTERNS: RegExp[] = [
  /\binterest\s+in\b/i,
  /\binter[eé]s\s+en\b/i,
  /\bpositive\s+momentum\b/i,
  /\bnegative\s+momentum\b/i,
  /\bpotential\s+closing\b/i,
  /\bcierre\s+potencial\b/i,
  /\bgood\s+momentum\b/i,
  /\bstrong\s+interest\b/i,
]

export function insightLineTooVagueForCalendarDescription(line: string): boolean {
  const t = line.replace(/\s+/g, ' ').trim()
  if (!t) return true
  return VAGUE_CALENDAR_DESCRIPTION_PATTERNS.some((re) => re.test(t))
}
