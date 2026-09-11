/** Bound the entire operation, including reading the body. Never retry implicitly. */
export async function notesRequest(url: string, init?: RequestInit, options:{timeoutMs?:number;fetcher?:typeof fetch}={}) {
  const controller=new AbortController()
  const headers=new Headers(init?.headers)
  if(!headers.has('Content-Type')) headers.set('Content-Type','application/json')
  let timer:ReturnType<typeof setTimeout>|undefined
  let onAbort:(()=>void)|undefined
  const cancelled=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{
      controller.abort()
      reject(Error('The request took too long. Please retry; your changes may already have been saved.'))
    },options.timeoutMs ?? 60_000)
    onAbort=()=>{controller.abort();reject(Error('The request was cancelled.'))}
    if(init?.signal?.aborted) onAbort()
    else init?.signal?.addEventListener('abort',onAbort,{once:true})
  })
  const request=async()=>{
    if(controller.signal.aborted) throw Error('The request was cancelled.')
    const response=await (options.fetcher || fetch)(url,{...init,headers,cache:'no-store',signal:controller.signal})
    const data=await response.json().catch(()=>{throw Error('The server returned an unreadable response. Please retry.')})
    if (!response.ok) throw Error(typeof data?.error==='string'?data.error:'Unable to save changes.')
    return data
  }
  try {return await Promise.race([cancelled,request()])}
  finally {clearTimeout(timer);if(onAbort)init?.signal?.removeEventListener('abort',onAbort)}
}
