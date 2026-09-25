import { normalizeProductField, productFieldToList } from './productField'
import type { VisitExtraction } from './visitExtraction'
import {compactCrmNarrative} from './compactCrmNarrative'
import {visitHeader} from './visitHeader'
import {
  stripExecutionBlocksFromCrmNarrative,
} from './crmNarrativeSanitize'

/** Fields needed to build the clipboard / share CRM note (matches app StructureResult). */
export type CrmSalesNoteInput = {
  schemaVersion?: 2
  extraction?: VisitExtraction
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
 * Structured notes: identity, one compact narrative, then explicit next steps.
 * Legacy notes retain their existing context-only export.
 */
export function formatProfessionalCrmNote(r: CrmSalesNoteInput): string {
  if (r.schemaVersion === 2 && r.extraction) {
    const v = r.extraction
    const es = v.language === 'Spanish'
    const header = visitHeader(v)
    // New contract makes summary complete. Legacy insight-only context is retained.
    const narrative = v.crmNarrativeVersion===1 && v.summary.trim() ? v.summary.trim() : compactCrmNarrative(v.summary,v.insights,v.language,v.contacts,v.companies)
    const soleOwner = v.contacts.length===1 && v.companies.length<=1 && v.actions.every(a=>a.contact===v.contacts[0] && a.company===(v.companies[0]||''))
    const describe = (a:VisitExtraction['actions'][number]) => {
      const owner=soleOwner ? '' : [a.contact,a.company].filter(Boolean).join(' — ')
      return `${owner ? `${owner}: ` : ''}${a.description}${a.date ? ` (${a.date}${a.time ? ` ${a.time}` : ''})` : ''}`
    }
    const commitments = v.actions.filter(a=>a.origin!=='recommendation').map(describe)
    const recommendations = v.actions.filter(a=>a.origin==='recommendation').map(describe)
    return [header,v.location && !narrative.toLowerCase().includes(v.location.toLowerCase()) && !header.toLowerCase().includes(v.location.toLowerCase()) ? v.location : '',narrative,
      commitments.length ? `${es ? 'Próximos pasos' : 'Next steps'}:\n${commitments.map(a=>`- ${a}`).join('\n')}` : '',
      recommendations.length ? `${es ? 'Sugerencias de Folup (no acordadas; fechas sugeridas)' : 'Folup suggestions (not agreed; suggested dates)'}:\n${recommendations.map(a=>`- ${a}`).join('\n')}` : '',
      v.questions.length ? `${es ? 'Pendiente de aclarar' : 'To clarify'}: ${v.questions.map(q=>q.question).join(' ')}` : '',
    ].filter(Boolean).join('\n\n')
  }
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
