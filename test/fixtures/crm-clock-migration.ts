import type {VisitExtraction} from '../../lib/visitExtraction'
import {calendarDraftFromAction} from '../../lib/calendarDraft'
import {visitActionFields} from '../../lib/visitExtraction'

// Migrate presentation ONLY; archived wording and event data remain frozen.
export function migrateCrmClock(crm:string,v:VisitExtraction):string {
  const lines=crm.split('\n')
  for(const action of v.actions){
    if(!action.date)continue
    const old=` (${action.date}${action.time?' '+action.time:''})`
    const draft=calendarDraftFromAction(visitActionFields(action,v.language),v.language,'America/Los_Angeles')
    const [h,m]=draft.time.split(':');const hour=Number(h)
    const clock=draft.time?` ${hour%12||12}:${m} ${hour<12?'AM':'PM'}`:''
    const proposed=draft.timeSuggested||draft.dateSuggested
    const replacement=` (${draft.date}${clock}${proposed?v.language==='Spanish'?' · horario propuesto':' · proposed schedule':''})`
    const index=lines.findIndex(line=>line.includes(action.description)&&line.endsWith(old))
    if(index>=0)lines[index]=lines[index].slice(0,-old.length)+replacement
  }
  return lines.join('\n')
}
