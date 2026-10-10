import {createHash} from 'node:crypto'
import type Stripe from 'stripe'
import {analyticsFromMetadata} from './analyticsBilling'
import {isInternalAnalyticsAccount} from './analyticsInternal'
import {deliverAnalytics} from './analyticsDelivery'

/** Only signed, paid subscription checkouts. Never infer payment from a redirect. */
export function paidAnalyticsPayload(event:Stripe.Event){
  if(event.type!=='checkout.session.completed'&&event.type!=='checkout.session.async_payment_succeeded')return null
  const s=event.data.object
  if(s.mode!=='subscription'||s.payment_status!=='paid'||!s.subscription)return null
  if(typeof event.livemode!=='boolean'||s.livemode!==event.livemode)return null
  const context=analyticsFromMetadata(s.metadata?.folup_analytics,s.metadata?.folup_analytics_context)
  if(!context)return null
  // Same checkout -> same UUID even if Stripe delivers both event types or retries.
  const h=createHash('sha256').update(`folup-paid:${s.id}`).digest('hex')
  return {uuid:`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`,event:'subscription_purchased',
    timestamp:new Date(event.created*1000).toISOString(),
    properties:{distinct_id:context.id,$process_person_profile:false,$geoip_disable:true,
      environment:event.livemode?'production':'test',is_internal:!event.livemode||context.internal===true||isInternalAnalyticsAccount(s.metadata?.user_email),confirmation:'server',
      ...(context.sessionId?{$session_id:context.sessionId}:{}),
      ...(context.firstSource?{first_source:context.firstSource}:{}),
      ...(context.sessionSource?{session_source:context.sessionSource}:{}),
      ...(context.visitorType?{visitor_type:context.visitorType}:{}),
      ...context.last,...Object.fromEntries(Object.entries(context.first).map(([k,v])=>[`first_${k}`,v])),
      ...Object.fromEntries(Object.entries(context.sessionCampaign||{}).map(([k,v])=>[`session_${k}`,v]))}}
}
/** Best effort: analytics outages must never break billing or grant paid access. */
export async function capturePaidAnalytics(event:Stripe.Event){
  const payload=paidAnalyticsPayload(event)
  if(!payload||process.env.VERCEL_ENV!=='production')return
  await deliverAnalytics(payload)
}
