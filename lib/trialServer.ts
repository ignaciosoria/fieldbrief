import {createHash,randomUUID} from 'node:crypto'
import {serverDb} from './serverDb'
import {runTrialStructure} from './trialStructure'

export async function withTrialNote<T extends {result:object}>(email:string,note:string,reference:unknown,extract:()=>Promise<T>,existingNoteId?:string,pendingKey?:string){
  const db=serverDb(), token=randomUUID()
  if(existingNoteId){
    const {data,error}=await db.from('folup_notes').select('id').eq('user_id',email).eq('id',existingNoteId).maybeSingle()
    if(error) throw Error('Note access unavailable')
    if(!data) return Response.json({error:'Note not found.'},{status:404})
    const ticket=await db.rpc('trial_key_for_saved_note',{p_user_id:email,p_note_id:existingNoteId})
    if(ticket.error) throw Error('Note access unavailable')
    // A client-created row alone cannot manufacture a free-processing pass.
    if(ticket.data){const value=await extract();return {...value,result:{...value.result,trialNoteKey:ticket.data}}}
  }
  if(!existingNoteId && pendingKey){
    const {data,error}=await db.rpc('trial_pending_key',{p_user_id:email,p_note_key:pendingKey})
    if(error) throw Error('Note access unavailable')
    if(!data) return Response.json({error:'This note is no longer awaiting clarification.'},{status:409})
    const value=await extract();return {...value,result:{...value.result,trialNoteKey:data}}
  }
  const key=createHash('sha256').update(JSON.stringify([note,reference??null])).digest('hex')
  const args={p_user_id:email,p_note_key:key,p_token:token}
  let reserved=false
  return runTrialStructure({extract:async()=>{
      const value=await extract()
      return reserved ? {...value,result:{...value.result,trialNoteKey:key}} : value
    },
    begin:async()=>{
      const {data,error}=await db.rpc('begin_trial_note',args)
      if(error || !['reserved','completed','unlimited','quota_exceeded','busy'].includes(data)) throw Error('Trial access unavailable')
      reserved=data==='reserved' || data==='completed'
      return data
    },
    finish:async(success)=>{
      const {data,error}=await db.rpc('finish_trial_note',{...args,p_success:success})
      if(error || typeof data!=='boolean') throw Error('Trial completion unavailable')
      return data
    },
  })
}
