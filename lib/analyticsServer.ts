import {after} from 'next/server'
import {serverAnalyticsPayload} from './analyticsServerPayload'
import type {AnalyticsEvent} from './analyticsPrivacy'
import {deliverAnalytics} from './analyticsDelivery'
/** Called only after the business operation succeeds; delivery never changes that outcome. */
export function scheduleAnalytics(request:Request,event:AnalyticsEvent,properties:Record<string,unknown>={},email?:string|null,idempotency?:string){
  try{
    if(process.env.VERCEL_ENV!=='production'||!['folup.app','www.folup.app'].includes(new URL(request.url).hostname))return
    const payload=serverAnalyticsPayload(request,event,properties,email,idempotency);if(!payload)return
    after(async()=>{await deliverAnalytics(payload)})
  }catch{console.warn('folup.analytics.schedule_failed',{event})}
}
