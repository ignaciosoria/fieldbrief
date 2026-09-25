/** Reserve before provider work, count only a successful result, release failures. */
export async function runTrialStructure<T>(deps:{
  begin:()=>Promise<'reserved'|'completed'|'unlimited'|'quota_exceeded'|'busy'>;
  finish:(success:boolean)=>Promise<boolean>;
  extract:()=>Promise<T>;
}):Promise<T|Response>{
  const state=await deps.begin()
  if(state==='quota_exceeded') return Response.json({error:'Your free trial has ended. Upgrade to Pro to process more notes. Your saved notes are still available.',code:'QUOTA_EXCEEDED'},{status:403})
  if(state==='busy') return Response.json({error:'A note is still processing. Please retry shortly.',code:'RATE_LIMITED'},{status:429,headers:{'Retry-After':'10'}})
  try {
    const result=await deps.extract()
    if(state==='reserved' && !await deps.finish(true)) throw Error('Trial completion unavailable')
    return result
  } catch(error) {
    if(state==='reserved') await deps.finish(false).catch(()=>false)
    throw error
  }
}
