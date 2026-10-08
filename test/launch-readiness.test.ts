import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {campaignFromParams,privatePageview} from '../lib/analyticsPrivacy'
import type {CaptureResult} from 'posthog-js'

test('all three Apollo variants survive privacy filtering',()=>{
  for(const c of ['a','b','c'])assert.equal(campaignFromParams(new URLSearchParams({utm_source:'apollo',utm_medium:'email',utm_campaign:'ag_field_pilot',utm_content:c})).utm_content,c)
})
test('guest events retain operational fields but never note or error content',()=>{
  for(const event of ['try_processing_started','try_processing_completed','try_processing_failed','try_calendar_clicked','try_claim_completed','try_claim_failed','try_recording_started','try_recording_failed','example_selected','try_cta_clicked']){
    const result=privatePageview({uuid:'test',event,properties:{$pathname:'/try',input_mode:'voice',duration_ms:42,has_smart_step:true,note:'PRIVATE',error:'PRIVATE',email:'PRIVATE'}} as CaptureResult,'anonymous')!
    assert.equal(result.event,event);assert.equal(result.properties.$pathname,'/try')
    assert.equal(result.properties.duration_ms,42);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/)
  }
})
test('live preview separates examples and accounts for Google return',()=>{
  const source=readFileSync('app/components/LiveTry.tsx','utf8')
  assert.match(source,/trackSigninComplete\(\)/)
  assert.match(source,/try_processing_completed/)
  assert.match(source,/example_selected/)
  assert.doesNotMatch(source,/track\('demo_completed'\)/)
  assert.match(source,/<AnalyticsPreference/)
})
test('support is real and 404 has recovery links',()=>{
  assert.match(readFileSync('app/components/PublicLanding.tsx','utf8'),/mailto:ignacio.isk@gmail.com/)
  assert.match(readFileSync('app/not-found.tsx','utf8'),/href="\/try"/)
})
