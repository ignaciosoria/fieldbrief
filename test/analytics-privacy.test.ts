import assert from 'node:assert/strict'
import {test} from 'node:test'
import {privatePageview,privateAnalyticsConfig} from '../lib/analyticsPrivacy'
import type {CaptureResult} from 'posthog-js'

const event:CaptureResult={uuid:'event-test',event:'$pageview',timestamp:new Date(0),properties:{
  token:'public-project-token',distinct_id:'person@example.test',$pathname:'/try',
  $current_url:'https://www.folup.app/try?email=person@example.test#private-note',
  $referrer:'https://crm.example.test/contact/private',transcript:'Private CRM visit',
  contact:'María',company:'Acme',$elements:[{text:'Private rendered note'}],
},$set:{email:'person@example.test'},$set_once:{name:'María'}}

test('analytics only keeps coarse page counts without visit text, identity, URLs or profiles',()=>{
  const result=privatePageview(event,'random-per-page-id')!
  assert.deepEqual(result.properties,{token:'public-project-token',distinct_id:'random-per-page-id',$pathname:'/try',$process_person_profile:false,$geoip_disable:true})
  assert.equal(result.$set,undefined);assert.equal(result.$set_once,undefined)
  assert.doesNotMatch(JSON.stringify(result),/person@example|private|María|Acme|transcript/)
  assert.equal(privatePageview({...event,properties:{...event.properties,$pathname:'/notes/private-customer'}},'random')?.properties.$pathname,'/other')
})

test('unknown, replay, interaction, error and identity events fail closed',()=>{
  for(const name of ['$snapshot','$autocapture','$copy_autocapture','$identify','$set','$pageleave','$exception','$web_vitals','$dead_click','$feature_flag_called','visit_saved']) assert.equal(privatePageview({...event,event:name},'random'),null)
  assert.equal(privatePageview(null,'random'),null)
})

test('analytics cannot collect DOM, recordings or remote-enabled features; no persisted identity',()=>{
  const config=privateAnalyticsConfig('random')
  for(const key of ['autocapture','capture_pageleave','capture_dead_clicks','rageclick','capture_heatmaps','capture_exceptions','capture_performance','ip'] as const) assert.equal(config[key],false,key)
  for(const key of ['disable_session_recording','disable_surveys','disable_external_dependency_loading','advanced_disable_flags','disable_persistence','mask_all_text','mask_all_element_attributes'] as const) assert.equal(config[key],true,key)
  assert.equal(config.person_profiles,'never')
  assert.equal(config.persistence,'memory')
  assert.equal(config.remote_config_refresh_interval_ms,0)
})
