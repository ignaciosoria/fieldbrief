/** Server-only transport. Retries reuse the exact UUID, timestamp and body. */
export type AnalyticsDeliveryPayload={event:string;uuid?:string;timestamp?:Date|string;properties:Record<string,unknown>}
type DeliveryOptions={key?:string;host?:string;send?:typeof fetch;pause?:(ms:number)=>Promise<void>;warn?:(message:string,details:Record<string,unknown>)=>void}

export async function deliverAnalytics(payload:AnalyticsDeliveryPayload,options:DeliveryOptions={}):Promise<boolean>{
  const key=options.key??process.env.NEXT_PUBLIC_POSTHOG_KEY
  const host=options.host??process.env.NEXT_PUBLIC_POSTHOG_HOST??'https://us.i.posthog.com'
  const warn=options.warn??((message,details)=>console.warn(message,details))
  if(!key||!['https://us.i.posthog.com','https://eu.i.posthog.com'].includes(host)){
    warn('folup.analytics.delivery_failed',{event:payload.event,reason:'configuration'})
    return false
  }
  const send=options.send??fetch,pause=options.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms)))
  const body=JSON.stringify({api_key:key,...payload,distinct_id:payload.properties.distinct_id})
  let status:number|undefined
  for(let attempt=1;attempt<=3;attempt++){
    let retry=true
    try{
      const response=await send(`${host}/i/v0/e/`,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(2500)})
      status=response.status
      if(response.ok)return true
      retry=status===408||status===429||status>=500
      // Never log the response body, credentials, IDs, or user content.
      await response.body?.cancel()
    }catch{status=undefined}
    if(!retry||attempt===3){
      warn('folup.analytics.delivery_failed',{event:payload.event,reason:status?'http':'network_or_timeout',status,attempts:attempt})
      return false
    }
    await pause(attempt*250)
  }
  return false
}
