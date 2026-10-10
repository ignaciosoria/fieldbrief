import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {CaptureResult} from 'posthog-js'
import type Stripe from 'stripe'
import {analyticsEvents,campaignFromParams,privatePageview} from '../lib/analyticsPrivacy'
import {restoreJourney,attributeJourney,JOURNEY_TTL} from '../lib/analyticsJourney'
import {analyticsMetadata,billingAnalytics} from '../lib/analyticsBilling'
import {paidAnalyticsPayload} from '../lib/analyticsBillingServer'

const id='12345678-1234-4234-8234-123456789abc'
const campaign={utm_source:'apollo',utm_medium:'email',utm_campaign:'ag_field_pilot'} as const
test('campaign attribution accepts only predefined non-personal campaign codes',()=>{
  assert.deepEqual(campaignFromParams(new URLSearchParams(campaign)),campaign)
  for(const value of ['email@example.com','Ignacio','ag_field_pilot/private',''])assert.deepEqual(campaignFromParams(new URLSearchParams({...campaign,utm_campaign:value})),{})
  assert.equal(campaignFromParams(new URLSearchParams({...campaign,utm_content:'customer@example.com'})).utm_content,undefined)
})
test('all permitted client events reject profile, DOM, CRM text and raw errors',()=>{
  for(const event of analyticsEvents){
    const result=privatePageview({event,properties:{token:'public',note:'SECRET',email:'SECRET',error:'SECRET',$current_url:'SECRET',$pathname:'/',input_mode:'voice',duration_ms:1200},$set:{email:'SECRET'}} as unknown as CaptureResult,id,{first:campaign,last:campaign,environment:'production'})!
    assert.equal(result.event,event);assert.equal(result.properties.first_utm_campaign,'ag_field_pilot')
    assert.equal(result.properties.distinct_id,id);assert.equal(result.properties.duration_ms,1200)
    assert.doesNotMatch(JSON.stringify(result),/SECRET|\$set/)
  }
  assert.equal(privatePageview({event:'subscription_purchased',properties:{}} as CaptureResult,id),null,'payment cannot be emitted by browser wrapper')
})
test('reload and OAuth retain bounded identity and first touch; later campaign changes last touch only',()=>{
  const j=attributeJourney(restoreJourney(null,100,()=>id),campaign)
  j.signinPending=true
  const restored=restoreJourney(JSON.parse(JSON.stringify(j)),200,()=> 'new')
  assert.equal(restored.id,id);assert.equal(restored.signinPending,true)
  const second=attributeJourney(restored,{...campaign,utm_campaign:'ag_field_followup'})
  assert.equal(second.first.utm_campaign,'ag_field_pilot');assert.equal(second.last.utm_campaign,'ag_field_followup')
  assert.equal(attributeJourney(second,{}).last.utm_campaign,'ag_field_followup')
  assert.equal(restoreJourney(j,100+JOURNEY_TTL,()=> 'new').id,'new')
  assert.equal(restoreJourney({...j,id:'email@example.com'},200,()=> 'new').id,'new')
})
test('billing attribution rejects non-UUID identities and strips arbitrary metadata',()=>{
  assert.equal(billingAnalytics({id:'email@example.com'}),undefined)
  const result=analyticsMetadata({id,first:campaign,last:campaign,email:'SECRET',note:'SECRET'})
  assert.doesNotMatch(JSON.stringify(result),/SECRET/)
  assert.ok(result.folup_analytics.length<=500)
})
function payment(overrides:Record<string,unknown>={},type='checkout.session.completed') {
  return {type,livemode:true,created:1800000100,data:{object:{id:'cs_test',livemode:true,created:1800000000,mode:'subscription',payment_status:'paid',subscription:'sub_test',metadata:{user_email:'SECRET',...analyticsMetadata({id,first:campaign,last:campaign})},...overrides}}} as unknown as Stripe.Event
}
test('only confirmed paid subscription checkout yields conversion; deterministic UUID suppresses retries',()=>{
  const a=paidAnalyticsPayload(payment())!
  assert.equal(a.event,'subscription_purchased')
  assert.equal(a.timestamp,new Date(1800000100*1000).toISOString())
  assert.equal(a.uuid,paidAnalyticsPayload(payment({},'checkout.session.async_payment_succeeded'))?.uuid)
  assert.doesNotMatch(JSON.stringify(a),/SECRET|cs_test|sub_test/)
  for(const overrides of [{payment_status:'unpaid'},{mode:'payment'},{subscription:null},{metadata:{}}])assert.equal(paidAnalyticsPayload(payment(overrides)),null)
  assert.equal(paidAnalyticsPayload(payment({},'customer.subscription.updated')),null)
})
