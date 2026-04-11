import { normalizeProductField, productFieldToList } from './productField'
import { isNoClearFollowUpResult } from './noFollowUp'

/** Fields needed to build the clipboard / share CRM note (matches app StructureResult). */
export type CrmSalesNoteInput = {
  customer: string
  contact: string
  contactCompany: string
  location: string
  acreage: string
  crop: string
  product: string
  crmText: string
  crmFull: string[]
  calendarDescription: string
  nextStep: string
  nextStepTitle: string
  nextStepDate?: string
  nextStepTimeHint?: string
  notes: string
  additionalSteps: {
    action: string
    contact?: string
    company?: string
    resolvedDate?: string
    timeHint?: string
    date?: string
    time?: string
  }[]
}

function productDisplayItems(crop: string, productCsv: string): string[] {
  const parts = productFieldToList(normalizeProductField(productCsv))
  const c = (crop || '').trim()
  if (!c) return parts
  if (parts.some((p) => p.toLowerCase() === c.toLowerCase())) return parts
  return [c, ...parts]
}

function stripEmojis(s: string): string {
  return s
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeInsightLine(line: string): string {
  return line
    .replace(/^(\s*)🌱/u, '$1📦')
    .replace(/^(\s*)🌾/u, '$1📊')
}

function filterInsightsForNote(lines: string[]): string[] {
  return lines
    .map(normalizeInsightLine)
    .filter((line) => !line.trimStart().startsWith('📅'))
    .map((line) => stripEmojis(line))
    .filter(Boolean)
}

function topCalendarLines(raw: string, max: number): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^→\s*/, '').trim())
    .filter(Boolean)
    .slice(0, max)
}

/** Same wall-clock resolution as app calendar (`app/page.tsx` `resolveTimeFromHint`). */
function resolveTimeFromHint(hint: string): { hour: number; minute: number } {
  const value = (hint || '').toLowerCase().trim()
  if (value === 'morning') return { hour: 9, minute: 0 }
  if (value === 'afternoon') return { hour: 15, minute: 0 }
  if (value === 'evening') return { hour: 18, minute: 0 }
  if (value === 'first thing') return { hour: 8, minute: 0 }
  if (value === 'noon') return { hour: 12, minute: 0 }
  if (!value) return { hour: 9, minute: 0 }

  const h24 = hint.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (h24) {
    const hour = Math.min(23, Math.max(0, parseInt(h24[1], 10)))
    const minute = Math.min(59, Math.max(0, parseInt(h24[2], 10)))
    return { hour, minute }
  }

  const h12 = hint.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\.?$/i)
  if (h12) {
    let hour = parseInt(h12[1], 10)
    const minute = h12[2] ? parseInt(h12[2], 10) : 0
    const ap = h12[3].toLowerCase()
    if (ap === 'pm' && hour < 12) hour += 12
    if (ap === 'am' && hour === 12) hour = 0
    return { hour: Math.min(23, hour), minute: Math.min(59, minute) }
  }

  const compact = hint.trim().match(/^(\d{1,2})\s*(pm|am)$/i)
  if (compact) {
    let hour = parseInt(compact[1], 10)
    if (compact[2].toLowerCase() === 'pm' && hour < 12) hour += 12
    if (compact[2].toLowerCase() === 'am' && hour === 12) hour = 0
    return { hour: Math.min(23, hour), minute: 0 }
  }

  return { hour: 9, minute: 0 }
}

function spokenTimeClause(hint: string): string {
  const { hour, minute } = resolveTimeFromHint(hint)
  if (hour === 17 && minute === 0) return 'before 5 PM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const ap = hour >= 12 ? 'PM' : 'AM'
  if (minute === 0) return `at ${h12} ${ap}`
  return `at ${h12}:${minute.toString().padStart(2, '0')} ${ap}`
}

function isEndOfBusinessDay(hint: string): boolean {
  const { hour, minute } = resolveTimeFromHint(hint)
  return hour === 17 && minute === 0
}

/** Natural phrasing for CRM paste — no MM/DD/YYYY parentheticals. */
function formatNaturalTimingPhrase(
  mmdd: string,
  hint: string,
  now: Date = new Date(),
): string {
  const h = (hint || '').trim()
  const m = (mmdd || '').trim()
  const mmddOk = /^\d{2}\/\d{2}\/\d{4}$/.test(m)

  if (!mmddOk) {
    if (!h) return ''
    return spokenTimeClause(h)
  }

  const [mm, dd, yyyy] = m.split('/').map((x) => parseInt(x, 10))
  const eventDate = new Date(yyyy, mm - 1, dd)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((eventDate.getTime() - today.getTime()) / 86400000)

  if (diff === 0) {
    if (!h) return 'today'
    if (isEndOfBusinessDay(h)) return 'today before 5 PM'
    return `today ${spokenTimeClause(h)}`
  }
  if (diff === 1) {
    if (!h) return 'tomorrow'
    if (isEndOfBusinessDay(h)) return 'tomorrow before 5 PM'
    return `tomorrow ${spokenTimeClause(h)}`
  }

  const monthShort = eventDate.toLocaleDateString('en-US', { month: 'short' })
  const dayNum = eventDate.getDate()
  if (!h) return `on ${monthShort} ${dayNum}`
  if (isEndOfBusinessDay(h)) return `on ${monthShort} ${dayNum} before 5 PM`
  return `on ${monthShort} ${dayNum} ${spokenTimeClause(h)}`
}

function stripCompanyFromActionLine(
  action: string,
  customer: string,
  contactCompany: string,
): string {
  let s = action.trim()
  const c1 = customer.toLowerCase()
  const c2 = (contactCompany || '').trim().toLowerCase()

  const em = ' — '
  const idx = s.lastIndexOf(em)
  if (idx !== -1) {
    const suffix = s.slice(idx + em.length).trim()
    const sl = suffix.toLowerCase()
    if (suffix && (sl === c1 || (c2 && sl === c2))) {
      s = s.slice(0, idx).trim()
    }
  }

  const paren = s.match(/\s*\(([^)]+)\)\s*$/)
  if (paren) {
    const inner = paren[1].trim().toLowerCase()
    if (inner === c1 || (c2 && inner === c2)) {
      s = s.replace(/\s*\([^)]+\)\s*$/, '').trim()
    }
  }
  return s
}

function formatCrmNextStepBullet(
  action: string,
  resolvedDate: string,
  timeHint: string,
  customer: string,
  contactCompany: string,
): string {
  const base = stripCompanyFromActionLine(action, customer, contactCompany)
  const timing = formatNaturalTimingPhrase(resolvedDate.trim(), timeHint.trim(), new Date())
  if (!timing) return base
  return `${base} ${timing}`.replace(/\s+/g, ' ').trim()
}

/**
 * Clean, professional sales note for CRM paste: header, situation, next steps, optional opportunities.
 * No emojis; minimal punctuation flourishes.
 */
export function formatProfessionalCrmNote(r: CrmSalesNoteInput): string {
  const cust = (r.customer || '').trim()
  const contact = (r.contact || '').trim()
  const company = (r.contactCompany || '').trim()
  const loc = (r.location || '').trim()
  const size = (r.acreage || '').trim()

  const line1 =
    cust && contact
      ? `${cust} — ${contact}`
      : cust || contact || 'Visit note'

  const metaBits: string[] = []
  if (loc) metaBits.push(loc)
  if (size) metaBits.push(size)
  const offerings = productDisplayItems(r.crop, r.product)
  if (offerings.length) {
    metaBits.push(`Offering discussed: ${offerings.join(', ')}`)
  }

  const rawCrm = (r.crmText || '').trim()
  let situation = ''
  if (rawCrm) {
    situation = stripEmojis(rawCrm)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n\n')
  } else {
    const fromInsights = filterInsightsForNote(r.crmFull || [])
    if (fromInsights.length) {
      situation = fromInsights.map((s) => (s.endsWith('.') ? s : `${s}.`)).join(' ')
    }
  }
  if (!situation) {
    const calLines = topCalendarLines((r.calendarDescription || '').trim(), 5)
    if (calLines.length) {
      situation = calLines.map((s) => (s.endsWith('.') ? s : `${s}.`)).join(' ')
    }
  }

  const primary = (r.nextStepTitle || r.nextStep || '').trim()
  const stepBullets: string[] = []
  const seen = new Set<string>()

  const pushBullet = (text: string) => {
    const t = text.trim()
    if (!t) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    stepBullets.push(t)
  }

  const noFollowUp = isNoClearFollowUpResult(r)
  if (!noFollowUp) {
    if (primary) {
      pushBullet(
        formatCrmNextStepBullet(
          primary,
          (r.nextStepDate || '').trim(),
          (r.nextStepTimeHint || '').trim(),
          cust,
          company,
        ),
      )
    }
    for (const step of r.additionalSteps || []) {
      const a = (step.action || '').trim()
      if (!a) continue
      const d = (step.resolvedDate || step.date || '').trim()
      const tm = (step.timeHint || step.time || '').trim()
      pushBullet(formatCrmNextStepBullet(a, d, tm, cust, company))
    }
  }

  const notes = (r.notes || '').trim()
  const opportunityBullets: string[] = []
  for (const line of r.crmFull || []) {
    if (line.includes('🆕')) {
      const cleaned = stripEmojis(line.replace(/🆕/g, '').trim())
      if (cleaned && !notes.toLowerCase().includes(cleaned.toLowerCase())) {
        const k = cleaned.toLowerCase()
        if (!seen.has(k)) {
          seen.add(k)
          opportunityBullets.push(cleaned)
        }
      }
    }
  }

  const out: string[] = []
  out.push(line1)
  if (metaBits.length) {
    out.push('')
    out.push(metaBits.join(' · '))
  }
  if (situation) {
    out.push('')
    out.push(situation)
  }
  if (stepBullets.length) {
    out.push('')
    out.push('Next steps:')
    for (const b of stepBullets) out.push(`- ${b}`)
  }
  const extraLines: string[] = []
  if (notes) extraLines.push(`- ${notes}`)
  for (const o of opportunityBullets) {
    if (notes && notes.toLowerCase().includes(o.toLowerCase())) continue
    extraLines.push(`- ${o}`)
  }
  if (extraLines.length) {
    out.push('')
    out.push('Additional opportunities')
    out.push(...extraLines)
  }

  return out.join('\n').trim()
}
