/**
 * Distinguish past narrative ("left the meeting") from real future tasks ("schedule a meeting Tuesday").
 * Used by action kind inference, title normalization, and structured-AI post-processing.
 */

const NARRATIVE_MEETING_DISCUSSION_RES: RegExp[] = [
  /\bjust\s+left\s+(the\s+)?meeting\b/i,
  /\b(left|after|before|during|from)\s+(the\s+)?meeting\b/i,
  /\b(at|in)\s+the\s+meeting\b/i,
  /\b(had|was|were)\s+(a\s+)?(meeting|discussion)\b/i,
  /\bthe\s+meeting\s+(was|went|ended)\b/i,
  /\bwe\s+(had|were\s+in)\s+(a\s+)?meeting\b/i,
  /\b(talked|spoke)\s+(to|with)\b/i,
  /\bwe\s+(talked|spoke|discussed)\b/i,
  /\bthey\s+(talked|spoke|discussed)\b/i,
  /\bdiscussion\s+(about|on|with|of)\b/i,
  /\b(a|the)\s+discussion\b/i,
  /\breviewed\b/i,
  /\b(post|pre)[- ]?mortem\b/i,
]

/** Spanish parallels for past visit / meeting as context. */
const NARRATIVE_ES_RES: RegExp[] = [
  /\b(salimos|salí)\s+de\s+la\s+reuni[oó]n\b/i,
  /\b(despu[eé]s|antes|durante)\s+de\s+la\s+reuni[oó]n\b/i,
  /\btuvimos\s+una\s+reuni[oó]n\b/i,
  /\bla\s+reuni[oó]n\s+(fue|termin[oó])\b/i,
  /\b(hablamos|habl[eé]|platicamos|conversamos)\s+con\b/i,
]

export function isNarrativeMeetingDiscussionContext(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  return [...NARRATIVE_MEETING_DISCUSSION_RES, ...NARRATIVE_ES_RES].some((re) => re.test(t))
}

/**
 * True when the note clearly schedules or requests a future meeting / meet, not past tense scene-setting.
 */
export function hasExplicitMeetScheduleIntent(text: string): boolean {
  const raw = (text || '').trim()
  if (!raw) return false
  const t = raw.toLowerCase().replace(/\s+/g, ' ')

  /** Scheduling cues first so notes that mix past context + a real request still qualify. */
  if (
    /\b(let'?s|let\s+us)\s+meet\b/.test(t) ||
    /\bmeet\s+(with|on|at)\b/.test(t) ||
    /\bmeet\s+(next|this|tomorrow|today)\b/.test(t) ||
    /\bmeet\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t) ||
    /\b(schedule|book|set\s+up|calendar|reserve)\s+(a\s+)?(meeting|call|time|slot)\b/.test(t) ||
    /\b(meeting|call)\s+(on|for)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t) ||
    /\bupcoming\s+meeting\b/.test(t) ||
    /\b(next|future)\s+meeting\b/.test(t) ||
    /\b(site\s+visit|office\s+visit)\b/.test(t) ||
    /\b(reuni[oó]n|reunirse)\s+(el|para|mañana|hoy|el\s+lunes)\b/.test(t) ||
    /\b(quedar|agendar)\s+(en\s+)?(una\s+)?(reuni[oó]n|cita)\b/.test(t)
  ) {
    return true
  }

  if (/\bmeeting\b/.test(t) && /\b(schedule|book|calendar|set\s+up|add\s+to)\b/.test(t)) return true

  if (/\b(nice|good|great)\s+to\s+meet\s+you\b/i.test(t)) {
    /* social pleasantry, not scheduling */
  } else {
    const m = raw.match(/\bmeet\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,})\b/i)
    if (m) {
      const w = m[1].toLowerCase()
      if (!['you', 'me', 'us', 'them', 'him', 'her', 'there', 'again'].includes(w)) return true
    }
  }

  if (isNarrativeMeetingDiscussionContext(text)) return false

  return false
}
