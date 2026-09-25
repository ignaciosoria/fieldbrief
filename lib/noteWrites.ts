import {notesRequest} from './notesClient'

export type PendingNoteWrite<T>={id:string;result:T;transcript:string;requestId:string;expectedVersion:number}
/** In-memory, owner-scoped checkpoints. Failed writes retain both payload and request ID.
 * Never rebase a retry onto a newly loaded version without user review. */
export class NoteWrites<T> {
  private pending=new Map<string,PendingNoteWrite<T>>()
  private running=new Map<string,Promise<{note:PendingNoteWrite<T>;version:number}>>()
  private key(owner:string,id:string){return JSON.stringify([owner,id])}
  get(owner:string,id:string){return this.pending.get(this.key(owner,id))}
  discard(owner:string,id:string){
    const key=this.key(owner,id)
    if(this.running.has(key))throw Error('Wait for saving to finish before discarding.')
    this.pending.delete(key)
  }
  save(owner:string,id:string,result:T,transcript:string,expectedVersion:number,
    send:(note:PendingNoteWrite<T>)=>Promise<{version:number}>=note=>notesRequest('/api/notes',{method:'PUT',body:JSON.stringify(note)})) {
    const key=this.key(owner,id), old=this.pending.get(key)
    if(old && (JSON.stringify(old.result)!==JSON.stringify(result) || old.transcript!==transcript))
      return Promise.reject(Error('A correction is still waiting to be saved. Retry or copy it before making another change.'))
    const running=this.running.get(key);if(running)return running
    if(!old && (!Number.isSafeInteger(expectedVersion)||expectedVersion<0))
      return Promise.reject(Error('Reload this note before correcting it.'))
    const note=old || {id,result:structuredClone(result),transcript,expectedVersion,requestId:crypto.randomUUID()}
    this.pending.set(key,note)
    const operation=Promise.resolve().then(()=>send(note)).then(response=>{
      if(!Number.isSafeInteger(response.version)||response.version<1)throw Error('Save could not be confirmed. Please retry.')
      this.pending.delete(key)
      return {note,version:response.version}
    }).finally(()=>this.running.delete(key))
    this.running.set(key,operation)
    return operation
  }
}
