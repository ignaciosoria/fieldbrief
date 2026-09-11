/** One bounded, buffered API response, including its body. Not for streaming UI.
 * Callers retain input and decide whether to retry; no automatic paid retries.
 */
export async function fetchWithTimeout(url:string,init:RequestInit,timeoutMs=75_000,fetcher:typeof fetch=fetch):Promise<Response> {
  const controller=new AbortController()
  let timeout:ReturnType<typeof setTimeout>|undefined
  let onAbort:(()=>void)|undefined
  const cancelled=new Promise<never>((_,reject)=>{
    timeout=setTimeout(()=>{
      reject(Error('The request took too long. Please try again.'))
      controller.abort()
    },timeoutMs)
    onAbort=()=>{
      reject(Error('The request was cancelled.'))
      controller.abort()
    }
    if(init.signal?.aborted) onAbort()
    else init.signal?.addEventListener('abort',onAbort,{once:true})
  })
  const operation=async()=>{
    if(controller.signal.aborted) throw Error('The request was cancelled.')
    const response=await fetcher(url,{...init,signal:controller.signal})
    if(!response.body) return response
    const body=await response.arrayBuffer()
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers})
  }
  try {return await Promise.race([cancelled,operation()])}
  finally {
    clearTimeout(timeout)
    if(onAbort) init.signal?.removeEventListener('abort',onAbort)
  }
}
