import {createHash} from 'node:crypto'
import type Stripe from 'stripe'
import {analyticsFromMetadata} from './analyticsBilling'

/** Only signed, paid subscription checkouts. Never infer payment from a redirect. */
export function paidAnalyticsPayload(event:Stripe.Event){
  if(event.type!=='checkout.session.completed'&&event.type!=='checkout.session.async_payment_succeeded')return null
  const s=event.data.object
  if(s.mode!=='subscription'||s.payment_status!=='paid'||!s.subscription)return null
  const context=analyticsFromMetadata(s.metadata?.folup_analytics)
  if(!context)return null
  // Same checkout -> same UUID even if Stripe delivers both event types or retries.
  const h=createHash('sha256').update(`folup-paid:${s.id}`).digest('hex')
  return {uuid:`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`,event:'subscription_purchased',
    timestamp:new Date(event.created*1000).toISOString(),
    properties:{distinct_id:context.id,$process_person_profile:false,$geoip_disable:true,environment:'production',...context.last,...Object.fromEntries(Object.entries(context.first).map(([k,v])=>[`first_${k}`,v]))}}
}
/** Best effort: analytics outages must never break billing or grant paid access. */
export async function capturePaidAnalytics(event:Stripe.Event){
  const payload=paidAnalyticsPayload(event)
  const key=process.env.NEXT_PUBLIC_POSTHOG_KEY
  if(!payload||!key||process.env.NODE_ENV!=='production')return
  const host=process.env.NEXT_PUBLIC_POSTHOG_HOST||'https://us.i.posthog.com'
  if(!['https://us.i.posthog.com','https://eu.i.posthog.com'].includes(host))return
  try {const response=await fetch(`${host}/i/v0/e/`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:key,distinct_id:payload.properties.distinct_id,...payload}),signal:AbortSignal.timeout(1000)})
    if(!response.ok)console.warn('Billing analytics delivery failed')
  }catch{console.warn('Billing analytics delivery unavailable')}
}
