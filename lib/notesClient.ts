import {readyAnalyticsHeaders,track} from './posthog'
import {analyticsAttempt} from './analyticsAttempt'
/** Bound the entire operation, including reading the body. Never retry implicitly. */
export async function notesRequest(url: string, init?: RequestInit, options:{timeoutMs?:number;fetcher?:typeof fetch;analyticsAttemptId?:string}={}) {
  const controller=new AbortController()
  const headers=new Headers(init?.headers)
  if(!headers.has('Content-Type')) headers.set('Content-Type','application/json')
  const attempt=url==='/api/notes'&&init?.method==='PUT'?analyticsAttempt(track,{start:'note_save_started',complete:'note_saved',fail:'note_save_failed'},{flow:'app',stage:'save'},Date.now,options.analyticsAttemptId):undefined
  let responseStatus:number|undefined
  let timer:ReturnType<typeof setTimeout>|undefined
  let onAbort:(()=>void)|undefined
  const cancelled=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{
      controller.abort()
      reject(new DOMException('The request took too long. Please retry; your changes may already have been saved.','TimeoutError'))
    },options.timeoutMs ?? 60_000)
    onAbort=()=>{controller.abort();reject(new DOMException('The request was cancelled.','AbortError'))}
    if(init?.signal?.aborted) onAbort()
    else init?.signal?.addEventListener('abort',onAbort,{once:true})
  })
  const request=async()=>{
    if(attempt)for(const [key,value] of Object.entries(await readyAnalyticsHeaders(attempt.id,attempt.properties)))headers.set(key,value)
    if(controller.signal.aborted) throw Error('The request was cancelled.')
    const response=await (options.fetcher || fetch)(url,{...init,headers,cache:'no-store',signal:controller.signal})
    responseStatus=response.status
    const data=await response.json().catch(()=>{throw Error('The server returned an unreadable response. Please retry.')})
    if (!response.ok) throw Error(typeof data?.error==='string'?data.error:'Unable to save changes.')
    return data
  }
  try {const result=await Promise.race([cancelled,request()]);attempt?.settle();return result}
  catch(error){attempt?.fail(error,responseStatus);throw error}
  finally {clearTimeout(timer);if(onAbort)init?.signal?.removeEventListener('abort',onAbort)}
}
