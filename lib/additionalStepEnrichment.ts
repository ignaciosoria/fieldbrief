import { resolveCalendarTimeHint, resolveRelativePhraseToMmdd, toUserAnchorDateTime } from './calendarResolveDate'

/** Supporting calendar rows — always include contact/company; timing when known or extractable from text. */
export type AdditionalStep = {
  action: string
  contact: string
  company: string
  resolvedDate: string
  timeHint: string
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

/**
 * Pull clock / period hints from free text when structured time was empty
 * (e.g. "call at 3pm", "por la mañana", "10:30 am").
 */
export function extractRoughTimeHint(text: string): string {
  const t = (text || '').trim()
  if (!t) return ''

  const lower = t.toLowerCase()
  if (/\bpor\s+la\s+mañana\b/.test(lower) || /\bin\s+the\s+morning\b/.test(lower)) return 'morning'
  if (/\bpor\s+la\s+tarde\b/.test(lower) || /\bin\s+the\s+afternoon\b/.test(lower)) return 'afternoon'
  if (/\bal\s+mediod[ií]a\b/.test(lower) || /\bnoon\b/.test(lower)) return 'noon'

  const m24 = t.match(/\b(\d{1,2}):(\d{2})\b/)
  if (m24) {
    const h = Math.min(23, Math.max(0, parseInt(m24[1], 10)))
    const min = Math.min(59, Math.max(0, parseInt(m24[2], 10)))
    return `${pad2(h)}:${pad2(min)}`
  }

  const m12 = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (m12) {
    let h = parseInt(m12[1], 10)
    const min = m12[2] ? parseInt(m12[2], 10) : 0
    const ap = m12[3].toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    return `${pad2(h)}:${pad2(min)}`
  }

  return ''
}

function mergeTimeHints(structured: string, action: string): string {
  const s = (structured || '').trim()
  if (s) return resolveCalendarTimeHint(s, action, action, '')
  const extracted = extractRoughTimeHint(action)
  if (!extracted) return ''
  return resolveCalendarTimeHint(extracted, action, action, '')
}

function mergeResolvedDate(
  existing: string,
  action: string,
  timeZone: string,
  anchor: ReturnType<typeof toUserAnchorDateTime>,
): string {
  const e = (existing || '').trim()
  if (e && /^\d{2}\/\d{2}\/\d{4}$/.test(e)) return e
  if (e) {
    const mmdd = resolveRelativePhraseToMmdd(e, timeZone, anchor)
    if (mmdd) return mmdd
  }
  if (action.trim()) {
    const fromAction = resolveRelativePhraseToMmdd(action, timeZone, anchor)
    if (fromAction) return fromAction
  }
  return e
}

/**
 * Fill contact/company defaults and backfill date/time from action text when missing.
 */
export function enrichAdditionalStepsList(
  result: {
    contact: string
    contactCompany: string
    customer: string
    additionalSteps: Partial<AdditionalStep & { date?: string; time?: string }>[]
  },
  timeZone: string,
  userNow: Date,
): AdditionalStep[] {
  const anchor = toUserAnchorDateTime(userNow, timeZone)
  const defaultContact = (result.contact || '').trim()
  const defaultCompany = (result.contactCompany || result.customer || '').trim()

  return (result.additionalSteps || [])
    .map((raw) => {
      const action = (raw.action || '').trim()
      if (!action) {
        return null
      }

      const legacyDate = (raw as { date?: string }).date
      const legacyTime = (raw as { time?: string }).time
      const resolvedDate = mergeResolvedDate(
        (raw.resolvedDate || legacyDate || '').trim(),
        action,
        timeZone,
        anchor,
      )
      const structuredTime = (raw.timeHint || legacyTime || '').trim()
      const timeHint = mergeTimeHints(structuredTime, action)

      return {
        action,
        contact: (raw.contact || '').trim() || defaultContact,
        company: (raw.company || '').trim() || defaultCompany,
        resolvedDate,
        timeHint,
      }
    })
    .filter((s): s is AdditionalStep => s !== null)
}
