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

const MIN_NOTE_CHARS_FOR_INSIGHTS = 35
const MIN_CRM_CHARS_FOR_INSIGHTS = 20
const MIN_INSIGHT_LINE_CHARS = 12
const FALLBACK_MAX_WORDS = 18

function truncateWords(s: string, maxWords: number): string {
  const w = s.replace(/\s+/g, ' ').trim().split(/\s+/)
  if (w.length <= maxWords) return s.replace(/\s+/g, ' ').trim()
  return w.slice(0, maxWords).join(' ')
}

function splitIntoSentences(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return []
  return t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_INSIGHT_LINE_CHARS)
}

/**
 * True when the note or CRM summary likely carries substantive context worth at least one insight line,
 * or when the model emitted insight strings that may have been stripped by the action-language filter.
 */
export function noteHasInsightableContext(
  note: string,
  crmSummary: string,
  rawInsightLines: string[],
): boolean {
  const n = note.replace(/\s+/g, ' ').trim()
  const c = crmSummary.replace(/\s+/g, ' ').trim()
  if (rawInsightLines.some((l) => l.trim().length > 0)) return true
  return n.length >= MIN_NOTE_CHARS_FOR_INSIGHTS || c.length >= MIN_CRM_CHARS_FOR_INSIGHTS
}

function firstPassingInsightFromSentences(sentences: string[]): string[] {
  for (const sentence of sentences) {
    const candidate = truncateWords(sentence, FALLBACK_MAX_WORDS)
    if (candidate.length < MIN_INSIGHT_LINE_CHARS) continue
    const filtered = filterInsightsToContextOnly([candidate])
    if (filtered.length > 0) return filtered
  }
  return []
}

function sentencesFromCrmSummary(crmSummary: string): string[] {
  const out: string[] = []
  for (const para of crmSummary.split(/\n+/)) {
    const p = para.trim()
    if (!p) continue
    const from = splitIntoSentences(p)
    if (from.length > 0) {
      out.push(...from)
    } else if (p.length >= MIN_INSIGHT_LINE_CHARS) {
      out.push(truncateWords(p, FALLBACK_MAX_WORDS))
    }
  }
  return out
}

function sentencesFromNote(note: string): string[] {
  const t = note.replace(/\s+/g, ' ').trim()
  if (!t) return []
  const from = splitIntoSentences(t)
  if (from.length > 0) return from
  if (t.length >= MIN_INSIGHT_LINE_CHARS) return [truncateWords(t, FALLBACK_MAX_WORDS)]
  return []
}

function genericInsightPlaceholder(langEs: boolean): string {
  return langEs
    ? 'Contexto de cuenta en el resumen CRM (ver narrativa).'
    : 'Account context in CRM summary (see narrative).'
}

/**
 * Never leave key insights empty when the note or CRM narrative is substantive.
 * Used after {@link filterInsightsToContextOnly}, which can drop every model line if it matched action wording.
 */
export function ensureMinimumCrmFullInsights(options: {
  crmFull: string[]
  rawInsightLines: string[]
  crmSummary: string
  note: string
  maxLines: number
  langEs: boolean
}): string[] {
  const { crmFull, rawInsightLines, crmSummary, note, maxLines, langEs } = options
  const capped = crmFull.slice(0, maxLines)
  if (capped.length > 0) return capped

  if (!noteHasInsightableContext(note, crmSummary, rawInsightLines)) {
    return []
  }

  const fromCrm = firstPassingInsightFromSentences(sentencesFromCrmSummary(crmSummary))
  if (fromCrm.length > 0) return fromCrm.slice(0, maxLines)

  const fromNote = firstPassingInsightFromSentences(sentencesFromNote(note))
  if (fromNote.length > 0) return fromNote.slice(0, maxLines)

  return [genericInsightPlaceholder(langEs)].slice(0, maxLines)
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
