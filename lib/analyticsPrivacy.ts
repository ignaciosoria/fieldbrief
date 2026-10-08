import type { CaptureResult, PostHogConfig } from 'posthog-js'

export const analyticsEvents = ['$pageview','demo_started','demo_completed','signin_started','signin_completed','note_processing_started','note_processed','note_processing_failed','crm_copied','calendar_save_started','calendar_saved','calendar_save_failed','calendar_connection_required','checkout_opened','checkout_failed','trial_limit_reached','voice_correction_started'] as const
export type AnalyticsEvent = typeof analyticsEvents[number]
export type Campaign = {utm_source?:'apollo';utm_medium?:'email';utm_campaign?:string;utm_content?:string}
export const campaignNames = ['ag_field_pilot','field_sales_pilot','ag_field_followup'] as const
/** Finite campaign codes, not arbitrary URL text (which can contain personal information). */
export function campaignFromParams(params:URLSearchParams):Campaign {
  if(params.get('utm_source')!=='apollo' || params.get('utm_medium')!=='email' || !campaignNames.includes(params.get('utm_campaign') as typeof campaignNames[number]))return {}
  const content=params.get('utm_content')
  return {utm_source:'apollo',utm_medium:'email',utm_campaign:params.get('utm_campaign')!,...(['a','b','followup_1','followup_2'].includes(content||'')?{utm_content:content!}:{})}
}
export function safeCampaign(value:unknown):Campaign {
  const params=new URLSearchParams()
  if(value && typeof value==='object')for(const key of ['utm_source','utm_medium','utm_campaign','utm_content']) {
    const v=(value as Record<string,unknown>)[key];if(typeof v==='string')params.set(key,v)
  }
  return campaignFromParams(params)
}
export type AnalyticsContext={first?:Campaign;last?:Campaign;environment?:'production'|'test'}
/** Rebuild from scratch: no SDK-enriched URL, DOM, profile, note or error text survives. */
export function privatePageview(event:CaptureResult|null,anonymousId:string,context:AnalyticsContext={}):CaptureResult|null {
  if (!event || !analyticsEvents.includes(event.event as AnalyticsEvent)) return null
  const pathname = event.properties.$pathname
  const page = pathname === '/' || pathname === '/try' ? pathname : '/other'
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
      ...safeCampaign(context.last),
      ...Object.fromEntries(Object.entries(safeCampaign(context.first)).map(([k,v])=>[`first_${k}`,v])),
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
    capture_pageview:true,
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
