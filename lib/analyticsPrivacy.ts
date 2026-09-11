import type { CaptureResult, PostHogConfig } from 'posthog-js'

/** Anonymous page counts only. Never pass through vendor-enriched or app properties. */
export function privatePageview(event:CaptureResult|null,anonymousId:string):CaptureResult|null {
  if (!event || event.event !== '$pageview') return null
  const pathname = event.properties.$pathname
  const page = pathname === '/' || pathname === '/try' ? pathname : '/other'
  return {
    uuid:event.uuid,
    event:'$pageview',
    timestamp:event.timestamp,
    properties:{
      token:event.properties.token,
      distinct_id:anonymousId,
      $pathname:page,
      $process_person_profile:false,
      $geoip_disable:true,
    },
  }
}

export function privateAnalyticsConfig(anonymousId:string):Partial<PostHogConfig> {
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
    before_send:event=>privatePageview(event,anonymousId),
  }
}
