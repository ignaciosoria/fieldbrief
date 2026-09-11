import assert from 'node:assert/strict'
import {test} from 'node:test'
import {CorrectionOwnerChanged,resumeVoiceCorrection,type VoiceCorrectionDraft} from '../lib/voiceCorrection'

const initial=():VoiceCorrectionDraft<{summary:string}>=>( {
  blob:new Blob(['synthetic-audio'],{type:'audio/webm'}),owner:'one@example.test',noteId:'existing-note',
  originalTranscript:'Met Ana at Acme. I will call tomorrow.',
  referenceNow:'2026-09-10T18:00:00Z',noteTimezone:'America/Los_Angeles',
  capturedAt:'2026-09-15T18:00:00Z',correctionTimezone:'America/Los_Angeles',
})

test('failed transcription retains audio and never invokes structure or save',async()=>{
  const draft=initial()
  await assert.rejects(resumeVoiceCorrection(draft,{
    currentOwner:()=>draft.owner,checkpoint:()=>assert.fail('No successful stage'),
    transcribe:async blob=>{assert.equal(blob,draft.blob);throw Error('503')},
    structure:async()=>{throw Error('Unexpected structure')},accept:async()=>assert.fail('Unexpected save'),
  }),/503/)
  assert.equal(await draft.blob.text(),'synthetic-audio')
  assert.equal(draft.combined,undefined)
})

test('structure retry skips transcription and keeps original and correction dates',async()=>{
  let draft=initial(),asrCalls=0,structureCalls=0
  const dependencies={
    currentOwner:()=>draft.owner,checkpoint:(next:typeof draft)=>{draft=next},
    transcribe:async()=>{asrCalls++;return 'Her name is Anna, not Ana.'},
    structure:async(note:string,now:string,timezone:string)=>{
      structureCalls++
      assert.equal(now,'2026-09-10T18:00:00Z')
      assert.equal(timezone,'America/Los_Angeles')
      assert.match(note,/CORRECTION RECORDED 2026-09-15T11:00:00.000-07:00/)
      assert.equal(note.match(/CORRECTION RECORDED/g)?.length,1)
      if(structureCalls===1) throw Error('Structure offline')
      return {summary:'Met Anna at Acme.'}
    },
    accept:async(result:{summary:string},note:string,id:string)=>{assert.equal(id,'existing-note');assert.equal(result.summary,'Met Anna at Acme.');assert.match(note,/Anna/)},
  }
  await assert.rejects(resumeVoiceCorrection(draft,dependencies),/Structure offline/)
  assert.equal(draft.correction,'Her name is Anna, not Ana.')
  await resumeVoiceCorrection(draft,dependencies)
  assert.equal(asrCalls,1);assert.equal(structureCalls,2)
})

test('save retry reuses the exact result and note id without any extra AI calls',async()=>{
  let draft=initial(),asrCalls=0,structureCalls=0,saveCalls=0
  const result={summary:'Met Anna.'}
  const dependencies={currentOwner:()=>draft.owner,checkpoint:(next:typeof draft)=>{draft=next},
    transcribe:async()=>{asrCalls++;return 'Anna, not Ana'},
    structure:async()=>{structureCalls++;return result},
    accept:async(value:typeof result,tx:string,id:string)=>{saveCalls++;assert.equal(value,result);assert.equal(id,'existing-note');assert.match(tx,/Anna, not Ana/);if(saveCalls===1)throw Error('Save offline')},
  }
  await assert.rejects(resumeVoiceCorrection(draft,dependencies),/Save offline/)
  await resumeVoiceCorrection(draft,dependencies)
  assert.equal(asrCalls,1);assert.equal(structureCalls,1);assert.equal(saveCalls,2)
})

test('account change at any async boundary stops subsequent stages and checkpoints',async()=>{
  for(const boundary of ['before','transcribe','structure','accept']) {
    const draft=initial();let owner=boundary==='before'?'two@example.test':draft.owner
    let checkpoints=0,accepts=0
    await assert.rejects(resumeVoiceCorrection(draft,{
      currentOwner:()=>owner,checkpoint:()=>{checkpoints++},
      transcribe:async()=>{if(boundary==='transcribe')owner='two@example.test';return 'Anna, not Ana'},
      structure:async()=>{if(boundary==='structure')owner='two@example.test';return {summary:'Met Anna.'}},
      accept:async()=>{accepts++;if(boundary==='accept')owner='two@example.test'},
    }),CorrectionOwnerChanged)
    assert.equal(checkpoints,boundary==='accept'?2:boundary==='structure'?1:0)
    assert.equal(accepts,boundary==='accept'?1:0)
  }
})

test('blank speech keeps audio and does not append an empty correction',async()=>{
  const draft=initial()
  await assert.rejects(resumeVoiceCorrection(draft,{
    currentOwner:()=>draft.owner,checkpoint:()=>assert.fail('Unexpected checkpoint'),
    transcribe:async()=> '  ',structure:async()=>{throw Error('Unexpected structure')},accept:async()=>assert.fail('Unexpected save'),
  }),/No speech/)
  assert.equal(draft.combined,undefined)
})
