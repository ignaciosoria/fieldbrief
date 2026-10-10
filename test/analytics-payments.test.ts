import assert from 'node:assert/strict'
import {test} from 'node:test'
import type Stripe from 'stripe'
import {analyticsMetadata,analyticsFromMetadata} from '../lib/analyticsBilling'
import {paidAnalyticsPayload} from '../lib/analyticsBillingServer'
const id='12345678-1234-4234-8234-123456789abc',sessionId='22345678-1234-4234-8234-123456789abc'
const campaign={utm_source:'apollo',utm_medium:'email',utm_campaign:'packaging_20261009',utm_content:'b'} as const
const context={id,first:campaign,last:campaign,sessionCampaign:campaign,sessionId,firstSource:'apollo',sessionSource:'apollo',visitorType:'returning'}
function event(livemode=true,internal=false,email='external@example.test'){
  return {type:'checkout.session.completed',livemode,created:1800000100,data:{object:{id:'cs_fixture',livemode,mode:'subscription',payment_status:'paid',subscription:'sub_fixture',metadata:{user_email:email,...analyticsMetadata(context,internal)}}}} as unknown as Stripe.Event
}
test('live external payment matches reporting filters and carries all three attribution scopes',()=>{
  const payload=paidAnalyticsPayload(event())!
  assert.equal(payload.properties.environment,'production');assert.equal(payload.properties.is_internal,false)
  const properties:Record<string,unknown>=payload.properties
  assert.equal(properties.first_utm_content,'b');assert.equal(properties.utm_content,'b');assert.equal(properties.session_utm_content,'b')
  assert.equal(payload.properties.$session_id,sessionId);assert.equal(payload.properties.confirmation,'server')
  assert.doesNotMatch(JSON.stringify(payload),/external@|cs_fixture|sub_fixture/)
})
test('Stripe test mode and internal accounts cannot become external production conversions',()=>{
  const sandbox=paidAnalyticsPayload(event(false))!
  assert.equal(sandbox.properties.environment,'test');assert.equal(sandbox.properties.is_internal,true)
  assert.equal(paidAnalyticsPayload(event(true,true))!.properties.is_internal,true)
  assert.equal(paidAnalyticsPayload(event(true,false,'ignacio.isk@gmail.com'))!.properties.is_internal,true)
  const invalid=event();(invalid as unknown as {livemode:unknown}).livemode=undefined
  assert.equal(paidAnalyticsPayload(invalid),null)
})
test('session metadata stays below Stripe limits, sanitizes input and reads legacy checkouts',()=>{
  const metadata=analyticsMetadata({...context,email:'PRIVATE',sessionId:'PRIVATE'},true)
  for(const value of Object.values(metadata)){assert.ok(value.length<=500);assert.doesNotMatch(value,/PRIVATE/)}
  const restored=analyticsFromMetadata(metadata.folup_analytics,metadata.folup_analytics_context)!
  assert.equal(restored.internal,true);assert.equal(restored.sessionCampaign?.utm_content,'b');assert.equal(restored.sessionId,undefined)
  assert.equal(analyticsFromMetadata(metadata.folup_analytics)?.id,id)
  assert.equal(analyticsFromMetadata(metadata.folup_analytics,'broken'),undefined)
  const retry=event();retry.type='checkout.session.async_payment_succeeded'
  assert.equal(paidAnalyticsPayload(retry)?.uuid,paidAnalyticsPayload(event())?.uuid)
})
