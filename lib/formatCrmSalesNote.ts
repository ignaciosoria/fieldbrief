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

/**
 * Clean, professional sales note for CRM paste: header, situation, next steps, optional opportunities.
 * No emojis; minimal punctuation flourishes.
 */
export function formatProfessionalCrmNote(r: CrmSalesNoteInput): string {
  const headerParts: string[] = []
  const cust = (r.customer || '').trim()
  const contact = (r.contact || '').trim()
  const company = (r.contactCompany || '').trim()
  const loc = (r.location || '').trim()
  const size = (r.acreage || '').trim()

  if (cust) headerParts.push(cust)
  const whoParts: string[] = []
  if (contact) whoParts.push(contact)
  if (company && company.toLowerCase() !== cust.toLowerCase()) whoParts.push(company)
  if (whoParts.length) headerParts.push(whoParts.join(', '))
  else if (contact && !cust) headerParts.push(contact)

  if (loc) headerParts.push(loc)
  if (size) headerParts.push(size)

  const offerings = productDisplayItems(r.crop, r.product)
  if (offerings.length) {
    headerParts.push(`Offering discussed: ${offerings.join(', ')}`)
  }

  const line1 =
    headerParts.length > 0
      ? headerParts.join(' — ')
      : contact || cust || 'Visit note'

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
    if (primary) pushBullet(primary)
    for (const step of r.additionalSteps || []) {
      const a = (step.action || '').trim()
      if (!a) continue
      const d = (step.resolvedDate || step.date || '').trim()
      const tm = (step.timeHint || step.time || '').trim()
      const dt = [d, tm].filter(Boolean).join(', ')
      pushBullet(dt ? `${a} (${dt})` : a)
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
  if (situation) {
    out.push('')
    out.push(situation)
  }
  if (stepBullets.length) {
    out.push('')
    out.push('Next steps')
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
