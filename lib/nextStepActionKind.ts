import {
  hasExplicitMeetScheduleIntent,
  isNarrativeMeetingDiscussionContext,
} from './actionIntentGuard'

/** Used for ranking primary next steps and default calendar clock times. */
export const ACTION_KIND_SCORE = {
  meeting: 100,
  call: 90,
  follow_up: 85,
  send: 60,
  other: 30,
} as const

export type ActionKind = keyof typeof ACTION_KIND_SCORE

export function isHigherValueKindThanSend(k: ActionKind): boolean {
  return k === 'meeting' || k === 'call' || k === 'follow_up'
}

/**
 * Infer kind from action text (EN/ES). Order: meeting → call → follow_up → send → other.
 */
export function inferActionKind(action: string): ActionKind {
  const a = action.toLowerCase()
  const narrative = isNarrativeMeetingDiscussionContext(action)

  if (!narrative) {
    if (
      /\b(demo|demostraci[oó]n|site\s+visit|appointment|cita\b|presentaci[oó]n|pitch|workshop|webinar|entrevista)\b/i.test(
        a,
      )
    ) {
      return 'meeting'
    }
    if (
      /\b(meeting|reuni[oó]n|reunion)\b/i.test(a) &&
      hasExplicitMeetScheduleIntent(action)
    ) {
      return 'meeting'
    }
    if (/\bvisita\b/i.test(a) && hasExplicitMeetScheduleIntent(action)) {
      return 'meeting'
    }
    if (/\bvisit\b(?!\s+note)/i.test(a) && hasExplicitMeetScheduleIntent(action)) {
      return 'meeting'
    }
    if (/\bmeet\b/i.test(a) && hasExplicitMeetScheduleIntent(action)) {
      return 'meeting'
    }
  }
  if (
    /\b(call|llamar|llama|llamada|phone|tel[ée]fono|callback|devolver\s+la\s+llamada|marcar|ring\b)\b/i.test(
      a,
    )
  ) {
    return 'call'
  }
  if (/\b(follow[-\s]?up|seguimiento|check[-\s]?in|touch\s*base|recheck)\b/i.test(a)) {
    return 'follow_up'
  }
  if (
    /\b(send|enviar|env[íi]a|email|e-mail|mail|deck|quote|cotiz|brochure|material|pdf|manda|mandar|forward|adjuntar|pasar(\s+el)?|share|deliver|delivery|compartir|entregar)\b/i.test(
      a,
    )
  ) {
    return 'send'
  }
  return 'other'
}

/** Default local wall-clock start for calendar events when the note has no specific time. */
export function defaultTimeForActionKind(kind: ActionKind): { hour: number; minute: number } {
  switch (kind) {
    case 'meeting':
      return { hour: 14, minute: 0 }
    case 'call':
      return { hour: 10, minute: 0 }
    case 'follow_up':
      return { hour: 11, minute: 0 }
    case 'send':
      return { hour: 9, minute: 0 }
    default:
      return { hour: 10, minute: 0 }
  }
}
