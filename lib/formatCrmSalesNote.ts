import { normalizeProductField, productFieldToList } from './productField'
import {
  stripExecutionBlocksFromCrmNarrative,
} from './crmNarrativeSanitize'

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
  /** Soft follow-up window when no fixed date (paste uses label, not a guessed day). */
  nextStepSoftTiming?: string
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

/**
 * Clean, professional sales note for CRM paste: header, situation / context, optional opportunities.
 * Does **not** include next steps, follow-up tasks, or scheduling — those live in the app’s Next step UI.
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

  const rawCrm = stripExecutionBlocksFromCrmNarrative((r.crmText || '').trim())
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

  const notes = (r.notes || '').trim()
  const opportunityBullets: string[] = []
  const seen = new Set<string>()
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
