import assert from 'node:assert/strict'
import {test} from 'node:test'
import {resumeVoiceCorrection} from '../lib/voiceCorrection'
import {visitExtractionResult,visitActionFields,type VisitExtraction} from '../lib/visitExtraction'
import {calendarDraftFromAction} from '../lib/calendarDraft'
import {googleEventPayload} from '../lib/googleCalendarEvent'
import {formatProfessionalCrmNote} from '../lib/formatCrmSalesNote'

const now='2026-09-24T18:00:00Z',zone='America/Los_Angeles'
const noteId='11111111-1111-4111-8111-111111111111'
// Deliberately simulated model responses: these assert downstream consistency,
// NOT model interpretation or microphone/transcription accuracy. No API calls.
for(const language of ['English','Spanish'] as const){
  const es=language==='Spanish'
  const baseline:VisitExtraction={language,contractVersion:3,crmNarrativeVersion:1,
    contacts:['Mike','Laura'],companies:['Valley','Alba'],location:'',
    summary:es?'Mike aprobó el pedido.':'Mike approved the order.',
    insights:[es?'Mike aprobó el pedido.':'Mike approved the order.'],questions:[],
    actions:[
      {type:'call',contact:'Mike',company:'Valley',object:'',subject:'Q7',description:es?'Comentar Q7.':'Discuss Q7.',date:'2026-09-29',time:'10:00',daypart:'unspecified',evidence:'Call Mike about Q7.'},
      {type:'send',contact:'Laura',company:'Alba',object:'K18',subject:'K18',description:es?'Enviar ficha K18 sin precios.':'Send K18 sheet without prices.',date:'2026-09-30',time:'11:30',daypart:'unspecified',evidence:'Send Laura the K18 sheet without prices.'},
    ]}
  const calendar=(e:VisitExtraction,index:number)=>googleEventPayload('test@example.test',{
    noteId,actionIndex:index,draft:calendarDraftFromAction(visitActionFields(e.actions[index],e.language),e.language,zone),
  })
  for(const kind of ['name','time','fact','recipient'] as const)test(`${language} correction ${kind}: CRM and Calendar payload agree, unrelated action intact`,async()=>{
    const original=structuredClone(baseline),expected=structuredClone(baseline)
    let correction=''
    if(kind==='name'){
      correction=es?'No era Mike, era Mark.':'Not Mike, Mark.'
      expected.contacts[0]='Mark';expected.actions[0].contact='Mark'
      expected.summary=expected.summary.replace('Mike','Mark');expected.insights=[expected.summary]
    }else if(kind==='time'){
      correction=es?'Llamar a Mike el jueves por la tarde, no el martes.':'Call Mike Thursday afternoon, not Tuesday.'
      expected.actions[0].date='2026-10-01';expected.actions[0].time='';expected.actions[0].daypart='afternoon'
    }else if(kind==='fact'){
      correction=es?'Mike no aprobó el pedido, solo pidió información.':'Mike did not approve the order; he only requested information.'
      expected.summary=correction;expected.insights=[correction]
    }else{
      correction=es?'La llamada de Q7 es para Tom de Northfield, lo de Laura sigue igual.':'The Q7 call is for Tom at Northfield; Laura stays unchanged.'
      expected.contacts.push('Tom');expected.companies.push('Northfield')
      expected.actions[0].contact='Tom';expected.actions[0].company='Northfield'
    }
    const response=visitExtractionResult(expected,now,zone)
    let saves=0
    await resumeVoiceCorrection({blob:new Blob(['simulated']),owner:'test@example.test',noteId,
      originalTranscript:'Call Mike about Q7. Send Laura the K18 sheet without prices.',referenceNow:now,noteTimezone:zone,
      capturedAt:'2026-09-25T18:00:00Z',correctionTimezone:zone},{
      currentOwner:()=> 'test@example.test',checkpoint:()=>{},transcribe:async()=>correction,
      structure:async(text,reference,timezone)=>{
        assert.ok(text.includes(correction));assert.equal(reference,now);assert.equal(timezone,zone)
        return response
      },accept:async(result,transcript,id)=>{
        saves++;assert.equal(id,noteId);assert.ok(transcript.includes(correction))
        const extraction=result.extraction!
        assert.deepEqual(extraction.actions[1],original.actions[1])
        assert.deepEqual(calendar(extraction,1),calendar(original,1))
        const event=calendar(extraction,0),crm=formatProfessionalCrmNote(result)
        assert.ok(crm.includes(extraction.actions[0].contact))
        assert.ok(event.summary.includes(extraction.actions[0].contact))
        assert.equal(event.description,calendar(expected,0).description)
        assert.equal(event.start.dateTime,calendar(expected,0).start.dateTime)
        if(kind==='name'){assert.doesNotMatch(crm,/Mike/);assert.doesNotMatch(JSON.stringify(event),/Mike/)}
        if(kind==='time'){assert.match(event.start.dateTime,/2026-10-01T15:00/);assert.match(crm,/2026-10-01/);assert.doesNotMatch(crm,/2026-09-29/)}
        if(kind==='fact'){assert.ok(crm.includes(correction));assert.deepEqual(event,calendar(original,0))}
        if(kind==='recipient'){assert.match(JSON.stringify(event),/Northfield/);assert.doesNotMatch(JSON.stringify(event),/Mike|Valley|Laura|Alba/)}
      },
    })
    assert.equal(saves,1)
    assert.deepEqual(baseline,original)
  })
}
