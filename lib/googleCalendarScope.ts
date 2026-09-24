// Requested only when the user explicitly connects Calendar, not at normal sign-in.
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned'
export function hasCalendarScope(scope:string):boolean {
  return scope.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE)
}
