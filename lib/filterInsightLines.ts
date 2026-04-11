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

/**
 * Past-tense openers often wrongly imply a task is done. Rewrite to pending phrasing.
 * Output must stay compatible with {@link insightLineContainsActionLanguage} (no bare send/call/…).
 */
export function normalizePendingInsightTense(line: string, spanish: boolean): string {
  let s = line.replace(/\s+/g, ' ').trim()
  if (!s) return s

  if (spanish) {
    s = s
      .replace(/^envié\s+/i, 'Pendiente entrega de ')
      .replace(/^llamé\s+/i, 'Contacto pendiente con ')
      .replace(/^enviad[oa]\s+/i, 'Pendiente entrega de ')
      .replace(/^llamad[oa]\s+/i, 'Contacto pendiente con ')
      .replace(/^revisé\s+/i, 'Revisión pendiente: ')
      .replace(/^comprobé\s+/i, 'Comprobación pendiente: ')
    return s.replace(/\s+/g, ' ').trim()
  }

  s = s
    .replace(/^sent\s*$/i, 'Outstanding delivery')
    .replace(/^sent\s+(.+)$/i, 'Needs $1 sent')
    .replace(/^called\s+(.+)$/i, 'Still to connect with $1')
    .replace(/^followed\s+up\s+on\s+(.+)$/i, 'Open item on $1')
    .replace(/^followed\s+up\s*$/i, 'Follow-on still open')
    .replace(/^checked\s+(.+)$/i, 'Still checking $1')
    .replace(/^emailed\s+(.+)$/i, 'Outreach to $1 still pending')
    .replace(/^mailed\s+(.+)$/i, 'Delivery to $1 still pending')

  return s.replace(/\s+/g, ' ').trim()
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
  /\bpotential\s+deal\b/i,
  /\bpotential\s+closing\b/i,
  /\bcierre\s+potencial\b/i,
  /\bgood\s+momentum\b/i,
  /\bstrong\s+interest\b/i,
  /\bdeal\s+potential\b/i,
  /\bopportunity\s+to\s+(close|win)\b/i,
  /\bnegocio\s+potencial\b/i,
  /\boportunidad\s+de\s+cierre\b/i,
]

export function insightLineTooVagueForCalendarDescription(line: string): boolean {
  const t = line.replace(/\s+/g, ' ').trim()
  if (!t) return true
  return VAGUE_CALENDAR_DESCRIPTION_PATTERNS.some((re) => re.test(t))
}
