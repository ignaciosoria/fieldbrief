import {after} from 'next/server'
import {serverAnalyticsPayload} from './analyticsServerPayload'
import type {AnalyticsEvent} from './analyticsPrivacy'
/** Called only after the business operation succeeds. No retries; deterministic event UUID. */
export function scheduleAnalytics(request:Request,event:AnalyticsEvent,properties:Record<string,unknown>={},email?:string|null,idempotency?:string){
  try{
    if(process.env.VERCEL_ENV!=='production'||!['folup.app','www.folup.app'].includes(new URL(request.url).hostname))return
    const key=process.env.NEXT_PUBLIC_POSTHOG_KEY,host=process.env.NEXT_PUBLIC_POSTHOG_HOST||'https://us.i.posthog.com'
    if(!key||!['https://us.i.posthog.com','https://eu.i.posthog.com'].includes(host))return
    const payload=serverAnalyticsPayload(request,event,properties,email,idempotency);if(!payload)return
    after(async()=>{try{await fetch(`${host}/i/v0/e/`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:key,...payload,distinct_id:payload.properties.distinct_id}),signal:AbortSignal.timeout(1500)})}catch{/* Telemetry must not change the outcome. */}})
  }catch{/* Missing runtime context must never break a successful save. */}
}
