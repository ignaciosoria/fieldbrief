import {serverDb} from './serverDb'

/** Best-effort audit only. Never makes saving depend on matching availability. */
export async function evaluateEntityShadow(owner:string,noteId:string) {
  try {
    const {error}=await serverDb().rpc('evaluate_folup_entity_shadow',{p_owner:owner,p_note:noteId})
      .abortSignal(AbortSignal.timeout(3000))
    if(error)console.warn('[entity-shadow] evaluation unavailable')
  } catch {console.warn('[entity-shadow] evaluation unavailable')}
}
