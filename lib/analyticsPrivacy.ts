import type { CaptureResult, PostHogConfig } from 'posthog-js'

export const analyticsEvents = ['$pageview','try_cta_clicked','example_viewed','example_selected','try_recording_started','try_recording_failed','try_processing_started','try_processing_completed','try_processing_failed','try_calendar_clicked','try_claim_completed','try_claim_failed','demo_started','demo_completed','signin_started','signin_completed','note_processing_started','note_processed','note_processing_failed','crm_copied','calendar_save_started','calendar_saved','calendar_save_failed','calendar_connection_required','checkout_opened','checkout_failed','trial_limit_reached','voice_correction_started','signin_failed','signin_result_unobserved','record_clicked','microphone_requested','microphone_granted','microphone_denied','recording_started','recording_completed','recording_cancelled','recording_failed','note_save_started','note_saved','note_updated','note_save_failed','note_result_received'] as const
export type AnalyticsEvent = typeof analyticsEvents[number]
export type Campaign = {utm_source?:'apollo';utm_medium?:'email';utm_campaign?:string;utm_content?:string}
export const campaignNames = ['ag_field_pilot','field_sales_pilot','ag_field_followup'] as const
/** Approved topic + date codes, never arbitrary URL text or recipient identifiers. */
export function campaignFromParams(params:URLSearchParams):Campaign {
  const name=params.get('utm_campaign')?.toLowerCase()||''
  if(params.get('utm_source')?.toLowerCase()!=='apollo' || params.get('utm_medium')?.toLowerCase()!=='email' || !(campaignNames.some(n=>n===name)||/^(packaging|ag_field|field_sales|agriculture|distribution|folup)_20\d{6}$/.test(name)))return {}
  const content=params.get('utm_content')?.toLowerCase()
  return {utm_source:'apollo',utm_medium:'email',utm_campaign:name,...(['a','b','c','followup_1','followup_2'].includes(content||'')?{utm_content:content!}:{})}
}
export function safeCampaign(value:unknown):Campaign {
  const params=new URLSearchParams()
  if(value && typeof value==='object')for(const key of ['utm_source','utm_medium','utm_campaign','utm_content']) {
    const v=(value as Record<string,unknown>)[key];if(typeof v==='string')params.set(key,v)
  }
  return campaignFromParams(params)
}
export const analyticsUuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
export type Source='direct'|'apollo'|'search'|'referral'|'unknown'
export type AnalyticsContext={first?:Campaign;last?:Campaign;sessionCampaign?:Campaign;sessionId?:string;firstSource?:Source;sessionSource?:Source;visitorType?:'new'|'returning';internal?:boolean;environment?:'production'|'test'}
const sources=['direct','apollo','search','referral','unknown']
export const analyticsErrorCodes=['permission_denied','microphone_missing','microphone_busy','unsupported','recording_error','empty_audio','network','timeout','aborted','unauthenticated','quota','conflict','rate_limited','server_error','invalid_response','unknown','auth_error'] as const
export function analyticsError(error:unknown,status?:number):typeof analyticsErrorCodes[number] {
  if(status===401)return 'unauthenticated';if(status===403)return 'quota';if(status===409)return 'conflict';if(status===429)return 'rate_limited';if(status&&status>=500)return 'server_error'
  const name=error instanceof Error?error.name:''
  return name==='NotAllowedError'?'permission_denied':name==='NotFoundError'?'microphone_missing':name==='NotReadableError'?'microphone_busy':name==='NotSupportedError'?'unsupported':name==='RecordingError'?'recording_error':name==='EmptyAudioError'?'empty_audio':name==='SyntaxError'?'invalid_response':name==='AbortError'?'aborted':name==='TimeoutError'?'timeout':name==='TypeError'?'network':'unknown'
}
/** Rebuild from scratch: no SDK-enriched URL, DOM, profile, note or error text survives. */
export function privatePageview(event:CaptureResult|null,anonymousId:string,context:AnalyticsContext={}):CaptureResult|null {
  if (!event || !analyticsEvents.includes(event.event as AnalyticsEvent)) return null
  const pathname = event.properties.$pathname
  const page = ['/', '/try', '/auth/error', '/privacy', '/terms'].includes(pathname) ? pathname : '/other'
  return {
    uuid:event.uuid,
    event:event.event,
    timestamp:event.timestamp,
    properties:{
      token:event.properties.token,
      distinct_id:anonymousId,
      $pathname:page,
      $process_person_profile:false,
      $geoip_disable:true,
      ...(context.environment?{environment:context.environment}:{}),
      ...(typeof context.internal==='boolean'?{is_internal:context.internal}:{}),
      ...(analyticsUuid(context.sessionId)?{$session_id:context.sessionId}:{}),
      ...(sources.includes(context.firstSource||'')?{first_source:context.firstSource}:{}),
      ...(sources.includes(context.sessionSource||'')?{session_source:context.sessionSource}:{}),
      ...(['new','returning'].includes(context.visitorType||'')?{visitor_type:context.visitorType}:{}),
      ...(['www.folup.app','folup.app','localhost','127.0.0.1'].includes(event.properties.$host)?{$host:event.properties.$host}:{}),
      ...safeCampaign(context.last),
      ...Object.fromEntries(Object.entries(safeCampaign(context.first)).map(([k,v])=>[`first_${k}`,v])),
      ...Object.fromEntries(Object.entries(safeCampaign(context.sessionCampaign)).map(([k,v])=>[`session_${k}`,v])),
      ...Object.fromEntries(['attempt_id','request_id','recording_attempt_id'].filter(k=>analyticsUuid(event.properties[k])).map(k=>[k,event.properties[k]])),
      ...(['app','guest','demo'].includes(event.properties.flow)?{flow:event.properties.flow}:{}),
      ...(['client','server'].includes(event.properties.confirmation)?{confirmation:event.properties.confirmation}:{}),
      ...(['auth','microphone','recording','transcription','extraction','processing','validation','save','calendar','export'].includes(event.properties.stage)?{stage:event.properties.stage}:{}),
      ...(analyticsErrorCodes.includes(event.properties.error_code)?{error_code:event.properties.error_code}:{}),
      ...(['voice','text'].includes(event.properties.input_mode)?{input_mode:event.properties.input_mode}:{}),
      ...(['commitment','recommendation','unknown'].includes(event.properties.action_origin)?{action_origin:event.properties.action_origin}:{}),
      ...(typeof event.properties.has_smart_step==='boolean'?{has_smart_step:event.properties.has_smart_step}:{}),
      ...(typeof event.properties.duration_ms==='number' && Number.isFinite(event.properties.duration_ms)?{duration_ms:Math.max(0,Math.min(600_000,Math.round(event.properties.duration_ms)))}:{}),
    },
  }
}

export function privateAnalyticsConfig(anonymousId:string,context:AnalyticsContext={}):Partial<PostHogConfig> {
  return {
    // Explicit local settings: remote configuration cannot enable content capture.
    autocapture:false,
    capture_pageview:false,
    capture_pageleave:false,
    capture_dead_clicks:false,
    rageclick:false,
    capture_heatmaps:false,
    capture_exceptions:false,
    capture_performance:false,
    disable_session_recording:true,
    disable_surveys:true,
    disable_external_dependency_loading:true,
    advanced_disable_flags:true,
    remote_config_refresh_interval_ms:0,
    person_profiles:'never',
    persistence:'memory',
    disable_persistence:true,
    ip:false,
    mask_all_text:true,
    mask_all_element_attributes:true,
    bootstrap:{distinctID:anonymousId,isIdentifiedID:false},
    before_send:event=>privatePageview(event,anonymousId,context),
  }
}
