import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {resumeVoiceCorrection} from '../lib/voiceCorrection'
import {visitExtractionResult} from '../lib/visitExtraction'
import {calendarDraftFromAction,googleCalendarUrl} from '../lib/calendarDraft'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'

// Recorded synthetic API outputs; this tests pipeline wiring, NOT microphone/ASR accuracy.
const rows=readFileSync(new URL('../eval/visit-v2-run-8.jsonl',import.meta.url),'utf8').trim().split('\n').map(line=>JSON.parse(line))
for(const language of ['es','en'])test(`${language}: simulated-ASR correction replaces CRM and calendar using same saved note`,async()=>{
 const extraction=rows.find(row=>row.id===`${language}-correct-all`).output
 const result=visitExtractionResult(extraction,'2026-09-10T18:00:00Z','America/Los_Angeles')
 const original=language==='es'?'Visité a José de AgroSol. Mañana le enviaré la ficha Q7 sin precios.':'Met Maya at Northstar. Tomorrow I will send her the Q7 sheet without prices.'
 const correction=language==='es'?'Era Pedro de Levante; jueves 17 de septiembre a las once y media, sin precios.':'It was Bob at Delta; Thursday September 17 at eleven thirty, without prices.'
 let saves=0
 await resumeVoiceCorrection({blob:new Blob(['fake audio']),owner:'test@example.test',noteId:'same-note',originalTranscript:original,referenceNow:'2026-09-10T18:00:00Z',noteTimezone:'America/Los_Angeles',capturedAt:'2026-09-15T18:00:00Z',correctionTimezone:'America/Los_Angeles'}, {
  currentOwner:()=> 'test@example.test',checkpoint:()=>{},transcribe:async()=>correction,
  structure:async(note,now)=>{assert.ok(note.startsWith(original));assert.ok(note.includes(correction));assert.equal(now,'2026-09-10T18:00:00Z');return result},
  accept:async(updated,transcript,id)=>{
   saves++;assert.equal(id,'same-note');assert.ok(transcript.includes(correction))
   const crm=formatProfessionalCrmNote(updated)
   assert.doesNotMatch(crm,/José|AgroSol|Maya|Northstar/)
   const params=new URL(googleCalendarUrl(calendarDraftFromAction(updated.primaryActionStructured!,extraction.language,'America/Los_Angeles'))!).searchParams
   assert.ok(params.get('text')!.includes(language==='es'?'Pedro':'Bob'))
   assert.match(params.get('details')!,/Q7/)
   assert.match(params.get('details')!,/sin precios|without prices/)
   assert.equal(params.get('dates'),'20260917T183000Z/20260917T190000Z')
  },
 })
 assert.equal(saves,1)
})
