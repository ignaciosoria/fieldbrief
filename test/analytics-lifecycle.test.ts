import assert from 'node:assert/strict'
import {test} from 'node:test'
import {analyticsAttempt,recordingAnalytics} from '../lib/analyticsAttempt'
import {analyticsError,privatePageview,privateAnalyticsConfig,campaignFromParams,type AnalyticsEvent} from '../lib/analyticsPrivacy'
import {arrivalSource,restoreJourney,touchJourney,SESSION_TTL} from '../lib/analyticsJourney'
import {serverAnalyticsPayload} from '../lib/analyticsServerPayload'
import {isInternalAnalyticsAccount} from '../lib/analyticsInternal'
const id='12345678-1234-4234-8234-123456789abc'
const session='22345678-1234-4234-8234-123456789abc'
const campaign=campaignFromParams(new URLSearchParams('utm_source=apollo&utm_medium=email&utm_campaign=packaging_20261009&utm_content=b&email=PRIVATE'))
function collector(){const events:Array<{event:AnalyticsEvent;properties:Record<string,unknown>}>=[];return {events,emit:(event:AnalyticsEvent,properties:Record<string,unknown>)=>{events.push({event,properties})}}}
test('dated Apollo variants survive OAuth, keep session and first touch; expiry creates a returning session',()=>{
  assert.equal(campaign.utm_campaign,'packaging_20261009');assert.equal(campaign.utm_content,'b')
  const j=touchJourney(restoreJourney(null,100,()=>id),campaign,'apollo',100,()=>session)
  const back=touchJourney(restoreJourney(JSON.parse(JSON.stringify(j)),200,()=>crypto.randomUUID()),{},arrivalSource({},'https://accounts.google.com/oauth?token=PRIVATE'),200,()=>crypto.randomUUID())
  assert.equal(back.id,id);assert.equal(back.session?.id,session);assert.equal(back.session?.source,'apollo');assert.equal(back.visitorType,'new')
  assert.deepEqual(back.first,campaign);assert.deepEqual(back.session?.campaign,campaign)
  const returning=touchJourney(back,{},'direct',201+SESSION_TTL,()=>crypto.randomUUID())
  assert.notEqual(returning.session?.id,session);assert.equal(returning.visitorType,'returning');assert.equal(returning.session?.source,'direct');assert.deepEqual(returning.first,campaign)
})
test('direct first touch is not rewritten by a later email campaign',()=>{
  const j=touchJourney(restoreJourney(null,1,()=>id),{},'direct',1,()=>session)
  const later=touchJourney(j,campaign,'apollo',2+SESSION_TTL,()=>crypto.randomUUID())
  assert.deepEqual(later.first,{});assert.equal(later.firstSource,'direct');assert.deepEqual(later.session?.campaign,campaign)
})
test('successful microphone recording, denial, cancellation and recorder error have mutually exclusive outcomes',()=>{
  const success=collector(),r=recordingAnalytics(success.emit,'app');r.granted();r.start();r.start();r.finish();r.finish();r.fail(Error('PRIVATE'))
  assert.deepEqual(success.events.map(e=>e.event),['record_clicked','microphone_requested','microphone_granted','recording_started','recording_completed'])
  for(const flow of ['app','guest'] as const){
    const denied=collector(),d=recordingAnalytics(denied.emit,flow);d.fail(new DOMException('PRIVATE','NotAllowedError'))
    assert.equal(denied.events.at(-1)?.properties.error_code,'permission_denied');assert.ok(denied.events.some(e=>e.event==='microphone_denied'));assert.ok(!denied.events.some(e=>e.event==='recording_started'))
    const cancelled=collector(),c=recordingAnalytics(cancelled.emit,flow);c.granted();c.start();c.cancel();assert.equal(c.finish(),false)
    assert.equal(cancelled.events.at(-1)?.event,'recording_cancelled')
    const failed=collector(),f=recordingAnalytics(failed.emit,flow);f.granted();f.start();f.fail(new DOMException('PRIVATE','RecordingError'));assert.equal(f.finish(),false)
    assert.equal(failed.events.at(-1)?.properties.error_code,'recording_error')
  }
})
test('processing failure and retry have different attempts; a later save error does not contradict processing success',()=>{
  const c=collector(),events={start:'note_processing_started',complete:'note_result_received',fail:'note_processing_failed'} as const
  const failed=analyticsAttempt(c.emit,events);failed.fail(Error('PRIVATE'),502);failed.fail(Error('again'))
  const retry=analyticsAttempt(c.emit,events);retry.complete({confirmation:'server'});retry.fail(Error('save failed'))
  assert.notEqual(failed.id,retry.id);assert.equal(c.events.filter(e=>e.event==='note_processing_failed').length,1)
  assert.equal(c.events[1].properties.error_code,'server_error')
  assert.equal(analyticsError(new DOMException('PRIVATE','TimeoutError')),'timeout')
})
function request(extra:Record<string,unknown>={},headers:Record<string,string>={}){
  return new Request('https://www.folup.app/api/notes',{headers:{'x-folup-analytics':JSON.stringify({id,context:{first:campaign,last:campaign,sessionCampaign:campaign,sessionId:session,internal:false,environment:'production'},properties:{attempt_id:id,request_id:session,$pathname:'/',email:'PRIVATE',token:'PRIVATE',transcript:'PRIVATE',$current_url:'https://secret/?token=PRIVATE',...extra}}),...headers}})
}
test('server save confirmation is sanitized, internal accounts work across devices, UUID survives retried saves',()=>{
  const a=serverAnalyticsPayload(request(),'note_saved',{},'ignacio.isk@gmail.com','owner:write')!
  const b=serverAnalyticsPayload(request({request_id:crypto.randomUUID()}),'note_saved',{},'ignacio.isk@gmail.com','owner:write')!
  assert.equal(a.uuid,b.uuid);assert.equal(a.properties.confirmation,'server');assert.equal(a.properties.is_internal,true)
  assert.equal(a.properties.$session_id,session)
  assert.equal(a.properties.first_utm_campaign,'packaging_20261009')
  assert.doesNotMatch(JSON.stringify(a),/PRIVATE|ignacio|owner:write/)
  assert.equal(isInternalAnalyticsAccount(' IGNACIO.ISK@GMAIL.COM '),true)
  assert.equal(serverAnalyticsPayload(request(),'note_saved',{},'external@example.test')?.properties.is_internal,false)
})
test('no consent context, opt-out headers and invalid IDs never produce server events',()=>{
  assert.equal(serverAnalyticsPayload(new Request('https://www.folup.app/api/notes'),'note_saved',{}),null)
  const cases:Record<string,string>[]=[{dnt:'1'},{'sec-gpc':'1'},{'x-folup-analytics':'not JSON'},{'x-folup-analytics':'x'.repeat(3001)}]
  for(const headers of cases)assert.equal(serverAnalyticsPayload(request({},headers),'note_saved',{}),null)
  assert.equal(serverAnalyticsPayload(request({attempt_id:'PRIVATE'}),'note_saved',{}),null)
})
test('collector filters error text, profile properties, unknown hosts and opt-in replay remains disabled',()=>{
  const safe=privatePageview({event:'note_processing_failed',uuid:id,properties:{error:'PRIVATE',error_code:'server_error',url:'PRIVATE',note:'PRIVATE',$host:'private.customer.example',$pathname:'/customer/PRIVATE',flow:'guest'}},id)!
  assert.doesNotMatch(JSON.stringify(safe),/PRIVATE|customer/);assert.equal(safe.properties.error_code,'server_error');assert.equal(safe.properties.$host,undefined)
  const config=privateAnalyticsConfig(id);assert.equal(config.capture_pageview,false);assert.equal(config.disable_session_recording,true);assert.equal(config.person_profiles,'never')
})
