/**
 * Strict display titles for CRM actions: built only from structured fields,
 * not from free-form nextStep / label prose.
 */

const EM = '\u2014'

export type ActionStructuredFields = {
  /** Primary: call | send | meeting | follow_up. Supporting: send | email | call | other */
  type: string
  /** When type is follow_up: soft | medium | hard (opportunity strength). */
  followUpStrength?: string
  verb: string
  /**
   * What is being sent (send/email): e.g. updated program, quote, samples.
   * Must be empty for call-style actions; never the contact’s name.
   */
  object: string
  contact: string
  company: string
  date: string
  time: string
}

function isSpanish(noteLanguage: string): boolean {
  return noteLanguage.trim().toLowerCase() === 'spanish'
}

function usesObjectForPrimary(type: string): boolean {
  const t = type.trim().toLowerCase()
  return t === 'send' || t === 'email'
}

function usesContactForPrimary(type: string): boolean {
  const t = type.trim().toLowerCase()
  return t === 'call' || t === 'follow_up' || t === 'meeting'
}

/** Stops "Send Send updated program" when the model repeats the verb inside `object`. */
function stripLeadingVerbFromObjectPhrase(object: string, verb: string, langEs: boolean): string {
  let o = object.trim()
  if (!o) return ''
  const lower = o.toLowerCase()
  const prefixes = [
    verb.toLowerCase(),
    'send',
    'email',
    'mail',
    ...(langEs ? ['enviar', 'correo', 'mandar'] : []),
  ].filter((p, i, a) => p && a.indexOf(p) === i)
  for (const p of prefixes) {
    if (lower.startsWith(p + ' ')) {
      o = o.slice(p.length).trim()
      break
    }
  }
  return o
}

/**
 * For send actions: never treat the contact name as the thing being sent (avoids "Send Sarah").
 */
export function normalizePrimarySendObjectField(
  object: string,
  contact: string,
  verb: string,
  noteLanguage: string,
): string {
  const langEs = isSpanish(noteLanguage)
  let o = object.trim()
  const c = contact.trim()
  if (c && o && o.toLowerCase() === c.toLowerCase()) return ''
  o = stripLeadingVerbFromObjectPhrase(o, verb.trim(), langEs)
  return o.trim()
}

/** Avoids "Call Call Sarah" when the model duplicates the action verb inside `contact`. */
function stripLeadingActionVerbFromContactName(contact: string, langEs: boolean): string {
  const s = contact.trim()
  if (!s) return ''
  const re = langEs
    ? /^(llamar\s+a\s+|llamar|call|reunirse\s+con\s+|reunirse|dar\s+seguimiento|seguimiento\s+con|seguimiento|phone)\s+/i
    : /^(call|meet(?:\s+with)?|phone|ring|follow[-\s]?up\s+with|follow[-\s]?up)\s+/i
  const stripped = s.replace(re, '').trim()
  return stripped || s
}

/**
 * Primary next-step line (no calendar date/time suffix).
 * Always include the **person** when known: `action … person — company`; send uses `a` / `to` before the name.
 * If contact is missing, fall back to company only (`Verb — Company` or `Verb object — Company` for send).
 */
export function buildPrimaryBaseTitle(fields: ActionStructuredFields, noteLanguage: string): string {
  const langEs = isSpanish(noteLanguage)
  const t = fields.type.trim().toLowerCase()
  let verb = fields.verb.trim()
  if (t === 'follow_up') {
    verb = langEs ? 'Seguimiento con' : 'Follow up with'
  }
  let object = fields.object.trim()
  const contact = fields.contact.trim()
  const company = fields.company.trim()

  if (usesObjectForPrimary(t)) {
    object = normalizePrimarySendObjectField(object, contact, verb, noteLanguage)
    const who = stripLeadingActionVerbFromContactName(contact, langEs)
    if (object && who && company) {
      return langEs
        ? `${verb} ${object} a ${who} ${EM} ${company}`
        : `${verb} ${object} to ${who} ${EM} ${company}`
    }
    if (object && who) {
      return langEs ? `${verb} ${object} a ${who}` : `${verb} ${object} to ${who}`
    }
    if (object && company) return `${verb} ${object} ${EM} ${company}`
    if (object) return `${verb} ${object}`
    if (company) return `${verb} ${EM} ${company}`
    return verb || (langEs ? 'Enviar/Entregar' : 'Send')
  }

  if (usesContactForPrimary(t)) {
    const who = stripLeadingActionVerbFromContactName(contact, langEs)
    if (t === 'follow_up') {
      const open = langEs ? 'Seguimiento con' : 'Follow up with'
      if (who && company) return `${open} ${who} ${EM} ${company}`
      if (who) return `${open} ${who}`
      if (company) return `${open} ${EM} ${company}`
      return open
    }
    if (t === 'call') {
      if (who && company) return langEs ? `Llamar a ${who} ${EM} ${company}` : `Call ${who} ${EM} ${company}`
      if (who) return langEs ? `Llamar a ${who}` : `Call ${who}`
      if (company) return langEs ? `Llamar ${EM} ${company}` : `Call ${EM} ${company}`
      return langEs ? 'Llamar' : 'Call'
    }
    if (t === 'meeting') {
      if (who && company) {
        return langEs ? `Reunirse con ${who} ${EM} ${company}` : `Meet with ${who} ${EM} ${company}`
      }
      if (who) return langEs ? `Reunirse con ${who}` : `Meet with ${who}`
      if (company) return langEs ? `Reunirse ${EM} ${company}` : `Meet ${EM} ${company}`
      return langEs ? 'Reunirse' : 'Meet'
    }
  }

  /** Unrecognized `type`: do not mix object vs contact (ambiguous); company-only or verb. */
  if (company) return `${verb} ${EM} ${company}`
  return verb
}

/**
 * Supporting action line (same rules; supporting uses send | email | call | other).
 * call / other → contact-style; send/email → object-style (object never replaces contact for calls).
 */
export function buildSupportingBaseTitle(fields: ActionStructuredFields, noteLanguage: string): string {
  const t = fields.type.trim().toLowerCase()
  if (t === 'send' || t === 'email') {
    return buildPrimaryBaseTitle({ ...fields, type: 'send' }, noteLanguage)
  }
  if (t === 'call' || t === 'other') {
    return buildPrimaryBaseTitle({ ...fields, type: 'call', object: '' }, noteLanguage)
  }
  return buildPrimaryBaseTitle(fields, noteLanguage)
}

export function verbForSupportingStructuredType(
  type: 'send' | 'email' | 'call' | 'other',
  langEs: boolean,
): string {
  if (langEs) {
    if (type === 'email') return 'Email'
    if (type === 'send') return 'Enviar/Entregar'
    return 'Llamar'
  }
  if (type === 'email') return 'Email'
  if (type === 'send') return 'Send'
  return 'Call'
}
