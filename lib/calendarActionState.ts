import type {CalendarDraft} from './calendarDraft'

export type CalendarActionState={actionId:string;actionIndex:number;snapshot:unknown;needsReview:boolean;
  saved?:{url:string;draft:CalendarDraft;sourceSnapshot:unknown}}
// JSON field order is not identity. All values came through JSON serialization.
export function sameActionSnapshot(a:unknown,b:unknown):boolean {
  const ordered=(v:unknown):unknown=>Array.isArray(v)?v.map(ordered):v && typeof v==='object'
    ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,ordered(x)])):v
  return JSON.stringify(ordered(a))===JSON.stringify(ordered(b))
}
