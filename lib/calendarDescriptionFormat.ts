/**
 * Deterministic calendar event body: context paragraph + action-specific closing.
 * The model supplies only structured commercial fields; this module produces final copy.
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

export function closingLineFor(
  kind: 'send' | 'call' | 'follow_up' | 'meeting',
  langEs: boolean,
): string {
  if (langEs) {
    switch (kind) {
      case 'send':
        return 'Enviar la comparativa para respaldar desempeño y diferenciación.'
      case 'call':
        return 'Llamar para revisar la comparativa y obtener retroalimentación.'
      case 'follow_up':
        return 'Dar seguimiento para mantener la conversación activa.'
      case 'meeting':
        return 'Reunirse para alinear próximos pasos y despejar dudas.'
    }
  }
  switch (kind) {
    case 'send':
      return 'Send the comparison to support performance and differentiation.'
    case 'call':
      return 'Call to review the comparison and get feedback.'
    case 'follow_up':
      return 'Follow up to keep the conversation moving.'
    case 'meeting':
      return 'Meet to align on next steps and open questions.'
  }
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
 * Final calendar description: optional context paragraph + deterministic closing from action type.
 */
export function formatForCalendar(
  actionType: CalendarFormatActionKind,
  structured: FormatForCalendarInput,
): string {
  const closing = closingLineFor(normalizeClosingKind(actionType), structured.langEs)
  const ctx = structured.contextParagraph.replace(/\s+/g, ' ').trim()
  if (!ctx) return closing
  return `${ctx}\n\n${closing}`.trim()
}
