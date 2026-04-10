/**
 * Strip parenthetical **timing** fragments from a next-step line for calendar SUMMARY only.
 * UI continues to use the full `nextStepTitle` from the API.
 */

function isTimingParenthetical(inner: string): boolean {
  const t = inner.trim().toLowerCase()
  if (!t) return false

  if (/\b(tomorrow|today|tonight|morning|afternoon|evening|noon|night|midday)\b/.test(t)) {
    return true
  }
  if (/\bnext\s+(week|month|year|quarter|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t)) {
    return true
  }
  if (/\b(this|last)\s+week\b/.test(t)) return true
  if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t)) {
    return true
  }
  if (/\b(week|month)s?\b/.test(t) && t.length < 40) return true
  if (/\b(in\s+)?\d+\s*(day|week|month|year)s?\b/.test(t)) return true
  if (/\b(en\s+)?\d+\s*(d[ií]as?|semanas?|meses?)\b/.test(t)) return true

  if (/\b(mañana|hoy|tarde|noche|mediod[ií]a|madrugada)\b/.test(t)) return true
  if (/\b(pr[oó]xim[oa]|siguiente)\s+(semana|mes|año)\b/.test(t)) return true
  if (/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/.test(t)) {
    return true
  }
  if (/\besta\s+semana\b/.test(t)) return true
  if (/\b(el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/.test(t)) {
    return true
  }

  if (/\d{1,2}[\/\-.]\d{1,2}/.test(t)) return true
  if (/^\d{1,2}\s*(:\d{2})?\s*(am|pm)\b/i.test(t)) return true

  return false
}

/**
 * Remove timing-only parenthetical expressions, e.g. `(next week)`, `(Monday)`, `(mañana)`.
 * Non-timing parentheses are left unchanged (e.g. product names) when they do not match timing heuristics.
 */
export function cleanCalendarTitle(title: string): string {
  let s = title.trim()
  if (!s) return ''

  let prev = ''
  while (s !== prev) {
    prev = s
    s = s.replace(/\s*\(([^)]*)\)/g, (full, inner: string) =>
      isTimingParenthetical(inner) ? ' ' : full,
    )
    s = s.replace(/\s+/g, ' ').trim()
  }

  return s
}
