/**
 * Deterministic calendar event body: context paragraph + action-specific closing.
 * The model supplies only structured commercial fields; this module produces final copy.
 * Closings use concrete verbs, real objects, and optional product names — no generic “performance / differentiation” filler.
 */

export type CommercialContextFields = {
  problem: string
  productInterest: string
  barrier: string
}

export type BuildCalendarContextInput = {
  contact: string
  company: string
  problem?: string
  productInterest?: string
  barrier?: string
  langEs: boolean
}

export type FormatForCalendarInput = {
  contextParagraph: string
  langEs: boolean
  /** Primary/supporting send object: comparativa, propuesta, PDF, resultados, etc. */
  deliverable?: string
  /** commercial_context.product_interest — used to derive a short product label when needed */
  productInterest?: string
  /** CRM product field (comma-separated) — first item preferred, e.g. Quantum Flower */
  productCsv?: string
}

/** Primary or supporting action kinds accepted by {@link formatForCalendar}. */
export type CalendarFormatActionKind =
  | 'call'
  | 'send'
  | 'meeting'
  | 'follow_up'
  | 'email'
  | 'other'

function normalizeClosingKind(kind: CalendarFormatActionKind): 'send' | 'call' | 'follow_up' | 'meeting' {
  if (kind === 'email') return 'send'
  if (kind === 'other') return 'follow_up'
  return kind
}

function firstProductFromCsv(csv: string): string {
  const parts = csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts[0] || ''
}

/** Short label from product_interest (first clause, capped) when CSV is empty. */
function extractProductLabelFromInterest(pi: string): string {
  const t = pi.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const cut = t.split(/[—–]/)[0].split(/\./)[0].trim()
  const words = cut.split(/\s+/).filter(Boolean)
  return words.slice(0, 8).join(' ')
}

function productLabelForClosing(input: Pick<FormatForCalendarInput, 'productCsv' | 'productInterest'>): string {
  const fromCsv = firstProductFromCsv(input.productCsv || '')
  if (fromCsv) return fromCsv.replace(/\s+/g, ' ').trim()
  return extractProductLabelFromInterest(input.productInterest || '')
}

function closingSendEs(deliverable: string, productLabel: string): string {
  const d = deliverable.replace(/\s+/g, ' ').trim()
  const p = productLabel.replace(/\s+/g, ' ').trim()
  const dl = d.toLowerCase()
  if (d && p && (dl.includes('comparativa') || dl.includes('comparación'))) {
    return `Enviar comparativa de ${p} con resultados de campo.`
  }
  if (d && p) {
    return `Enviar ${d} (${p}) con resultados de campo.`
  }
  if (d) {
    return `Enviar ${d} con resultados de campo.`
  }
  if (p) {
    return `Enviar material de ${p} con resultados de campo.`
  }
  return 'Enviar material acordado con resultados de campo.'
}

function closingSendEn(deliverable: string, productLabel: string): string {
  const d = deliverable.replace(/\s+/g, ' ').trim()
  const p = productLabel.replace(/\s+/g, ' ').trim()
  if (d && p) {
    return `Send ${d} — ${p} with field results.`
  }
  if (d) {
    return `Send ${d} with field results.`
  }
  if (p) {
    return `Send ${p} materials with field results.`
  }
  return 'Send agreed materials with field results.'
}

function closingCallEs(deliverable: string): string {
  const d = deliverable.replace(/\s+/g, ' ').trim()
  if (d) {
    return `Llamar para revisar ${d} y próximos pasos.`
  }
  return 'Llamar para revisar la comparativa y próximos pasos.'
}

function closingCallEn(deliverable: string): string {
  const d = deliverable.replace(/\s+/g, ' ').trim()
  if (d) {
    return `Call to review ${d} and next steps.`
  }
  return 'Call to review the comparison and next steps.'
}

function closingFollowUpEs(): string {
  return 'Dar seguimiento para alinear próximos pasos.'
}

function closingFollowUpEn(): string {
  return 'Follow up to align on next steps.'
}

function closingMeetingEs(): string {
  return 'Reunirse para revisar la visita y próximos pasos.'
}

function closingMeetingEn(): string {
  return 'Meet to review the visit and next steps.'
}

/**
 * Action line (second block): verb + object (+ product when relevant). No vague “performance / differentiation” filler.
 */
export function buildActionClosingLine(
  kind: 'send' | 'call' | 'follow_up' | 'meeting',
  input: Pick<FormatForCalendarInput, 'langEs' | 'deliverable' | 'productInterest' | 'productCsv'>,
): string {
  const langEs = input.langEs
  const productLabel = productLabelForClosing(input)
  const deliverable = (input.deliverable || '').trim()

  switch (kind) {
    case 'send':
      return langEs ? closingSendEs(deliverable, productLabel) : closingSendEn(deliverable, productLabel)
    case 'call':
      return langEs ? closingCallEs(deliverable) : closingCallEn(deliverable)
    case 'follow_up':
      return langEs ? closingFollowUpEs() : closingFollowUpEn()
    case 'meeting':
      return langEs ? closingMeetingEs() : closingMeetingEn()
  }
}

/** @deprecated Use {@link buildActionClosingLine} with deliverable / product hints. */
export function closingLineFor(
  kind: 'send' | 'call' | 'follow_up' | 'meeting',
  langEs: boolean,
): string {
  return buildActionClosingLine(kind, { langEs })
}

/**
 * One short paragraph: contact/company, then problem, product interest, barrier — only non-empty fields.
 */
export function buildCalendarContext(input: BuildCalendarContextInput): string {
  const { contact, company, problem, productInterest, barrier, langEs } = input
  const c = contact.replace(/\s+/g, ' ').trim()
  const co = company.replace(/\s+/g, ' ').trim()
  const pr = (problem || '').replace(/\s+/g, ' ').trim()
  const pi = (productInterest || '').replace(/\s+/g, ' ').trim()
  const ba = (barrier || '').replace(/\s+/g, ' ').trim()

  const segs: string[] = []
  if (c && co) {
    segs.push(langEs ? `${c} en ${co}` : `${c} at ${co}`)
  } else if (c) {
    segs.push(c)
  } else if (co) {
    segs.push(co)
  }
  if (pr) segs.push(pr)
  if (pi) segs.push(pi)
  if (ba) segs.push(ba)

  if (segs.length === 0) return ''

  let text = segs.map((s) => s.replace(/\.\s*$/g, '').trim()).join('. ')
  if (!/[.!?]$/.test(text)) text += '.'
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Final calendar description: optional context paragraph + action line (verb + object + product when relevant).
 */
export function formatForCalendar(
  actionType: CalendarFormatActionKind,
  structured: FormatForCalendarInput,
): string {
  const kind = normalizeClosingKind(actionType)
  const closing = buildActionClosingLine(kind, {
    langEs: structured.langEs,
    deliverable: structured.deliverable,
    productInterest: structured.productInterest,
    productCsv: structured.productCsv,
  })
  const ctx = structured.contextParagraph.replace(/\s+/g, ' ').trim()
  if (!ctx) return closing
  return `${ctx}\n\n${closing}`.trim()
}
