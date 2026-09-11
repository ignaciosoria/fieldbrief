/** One bounded attempt; callers retain input and decide whether to retry. */
export async function fetchWithTimeout(url:string,init:RequestInit,timeoutMs=75_000,fetcher:typeof fetch=fetch):Promise<Response> {
  const controller=new AbortController()
  const timeout=setTimeout(()=>controller.abort(),timeoutMs)
  try {return await fetcher(url,{...init,signal:controller.signal})}
  catch (error) {
    if(controller.signal.aborted) throw Error('The request took too long. Please try again.')
    throw error
  } finally {clearTimeout(timeout)}
}
