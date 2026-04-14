/**
 * Deterministic calendar event body: line 1 = cuenta + problema; line 2 = frase de acción concreta.
 * Sin lenguaje abstracto (desempeño, diferenciación, evaluación).
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
  /** Línea 1: debe ser solo contacto + empresa + problema (vía {@link buildCalendarContext}). */
  contextParagraph: string
  langEs: boolean
  /** Nombre de producto explícito (ej. Quantum Flower) si existe en datos estructurados; prioridad sobre CSV/interest */
  product?: string
  deliverable?: string
  productInterest?: string
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

function extractProductLabelFromInterest(pi: string): string {
  const t = pi.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const cut = t.split(/[—–]/)[0].split(/\./)[0].trim()
  const words = cut.split(/\s+/).filter(Boolean)
  return words.slice(0, 8).join(' ')
}

function productLabelForSend(
  input: Pick<FormatForCalendarInput, 'product' | 'productCsv' | 'productInterest'>,
): string {
  const explicit = (input.product || '').replace(/\s+/g, ' ').trim()
  if (explicit) return explicit
  const fromCsv = firstProductFromCsv(input.productCsv || '')
  if (fromCsv) return fromCsv
  return extractProductLabelFromInterest(input.productInterest || '')
}

/**
 * Línea 1: {contact} en {company}. {problem} (ES) / {contact} at {company}. {problem} (EN)
 * Solo cuenta + problema; sin barrera ni interés mezclados aquí.
 */
export function buildCalendarContext(input: BuildCalendarContextInput): string {
  const { contact, company, problem, langEs } = input
  const c = contact.replace(/\s+/g, ' ').trim()
  const co = company.replace(/\s+/g, ' ').trim()
  const pr = (problem || '').replace(/\s+/g, ' ').trim()

  const who =
    c && co ? (langEs ? `${c} en ${co}` : `${c} at ${co}`) : c ? c : co ? co : ''
  if (!who && !pr) return ''
  if (!pr) {
    const w = who.endsWith('.') ? who.trim() : `${who}.`
    return w.charAt(0).toUpperCase() + w.slice(1)
  }
  const whoPart = who.endsWith('.') ? who.slice(0, -1).trim() : who
  const probPart = pr.endsWith('.') ? pr.trim() : `${pr}.`
  const out = `${whoPart}. ${probPart}`.replace(/\s+/g, ' ').trim()
  return out.charAt(0).toUpperCase() + out.slice(1)
}

/** SEND — plantilla fija; producto si existe. */
function closingSendEs(product: string): string {
  const p = product.replace(/\s+/g, ' ').trim()
  if (p) {
    return `Enviar comparativa de ${p} con resultados de campo.`
  }
  return 'Enviar comparativa con resultados de campo.'
}

function closingSendEn(product: string): string {
  const p = product.replace(/\s+/g, ' ').trim()
  if (p) {
    return `Send ${p} comparison with field results.`
  }
  return 'Send comparison with field results.'
}

/** CALL — plantilla fija. */
function closingCallEs(): string {
  return 'Llamar para revisar la comparativa y ver próximos pasos.'
}

function closingCallEn(): string {
  return 'Call to review the comparison and see next steps.'
}

/** FOLLOW_UP — plantilla fija. */
function closingFollowUpEs(): string {
  return 'Dar seguimiento para ver interés y próximos pasos.'
}

function closingFollowUpEn(): string {
  return 'Follow up to gauge interest and next steps.'
}

/** MEETING — concreto, sin términos abstractos. */
function closingMeetingEs(): string {
  return 'Reunirse para ver la visita y próximos pasos.'
}

function closingMeetingEn(): string {
  return 'Meet on site to review next steps.'
}

/**
 * Segunda línea: verbo + objeto; plantillas por tipo de acción.
 */
export function buildActionClosingLine(
  kind: 'send' | 'call' | 'follow_up' | 'meeting',
  input: Pick<FormatForCalendarInput, 'langEs' | 'product' | 'productInterest' | 'productCsv'>,
): string {
  const langEs = input.langEs
  const product = productLabelForSend(input)

  switch (kind) {
    case 'send':
      return langEs ? closingSendEs(product) : closingSendEn(product)
    case 'call':
      return langEs ? closingCallEs() : closingCallEn()
    case 'follow_up':
      return langEs ? closingFollowUpEs() : closingFollowUpEn()
    case 'meeting':
      return langEs ? closingMeetingEs() : closingMeetingEn()
  }
}

/** @deprecated Use {@link buildActionClosingLine}. */
export function closingLineFor(
  kind: 'send' | 'call' | 'follow_up' | 'meeting',
  langEs: boolean,
): string {
  return buildActionClosingLine(kind, { langEs })
}

/**
 * Línea 1 = contextParagraph (contacto + empresa + problema). Línea 2 = plantilla de acción.
 */
export function formatForCalendar(
  actionType: CalendarFormatActionKind,
  structured: FormatForCalendarInput,
): string {
  const kind = normalizeClosingKind(actionType)
  const line1 = structured.contextParagraph.replace(/\s+/g, ' ').trim()
  const closing = buildActionClosingLine(kind, {
    langEs: structured.langEs,
    product: structured.product,
    productInterest: structured.productInterest,
    productCsv: structured.productCsv,
  })
  if (!line1) return closing
  return `${line1}\n\n${closing}`.trim()
}
