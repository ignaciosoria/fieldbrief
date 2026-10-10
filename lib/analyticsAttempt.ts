import {analyticsError,type AnalyticsEvent} from './analyticsPrivacy'
type Emit=(event:AnalyticsEvent,properties:Record<string,unknown>)=>void
/** One logical outcome per attempt; retries are new attempts, not a time-based dedupe. */
export function analyticsAttempt(emit:Emit,events:{start:AnalyticsEvent;complete:AnalyticsEvent;fail:AnalyticsEvent},properties:Record<string,unknown>={},now=Date.now,id:string=crypto.randomUUID()){
  const started=now();let settled=false
  const props={...properties,attempt_id:id,request_id:crypto.randomUUID()}
  emit(events.start,props)
  return {id,properties:props,
    complete(extra:Record<string,unknown>={}){if(settled)return;settled=true;emit(events.complete,{...props,...extra,duration_ms:now()-started})},
    fail(error:unknown,status?:number,extra:Record<string,unknown>={}){if(settled)return;settled=true;emit(events.fail,{...props,...extra,duration_ms:now()-started,error_code:analyticsError(error,status)})},
    settle(){settled=true}}
}
export function recordingAnalytics(emit:Emit,flow:'app'|'guest',now=Date.now){
  const id=crypto.randomUUID(),started=now();let settled=false,recording=false,recordedAt=started
  const props={attempt_id:id,input_mode:'voice',flow}
  emit('record_clicked',props);emit('microphone_requested',props)
  return {id,
    granted(){if(settled)return false;emit('microphone_granted',props);return true},
    start(){if(recording||settled)return;recording=true;recordedAt=now();emit(flow==='guest'?'try_recording_started':'recording_started',props)},
    finish(hasAudio=true){if(settled)return false;settled=true;if(!hasAudio){emit(flow==='guest'?'try_recording_failed':'recording_failed',{...props,error_code:'empty_audio'});return false}emit('recording_completed',{...props,duration_ms:now()-recordedAt});return true},
    cancel(){if(settled)return;settled=true;emit('recording_cancelled',{...props,duration_ms:now()-started})},
    fail(error:unknown){if(settled)return;settled=true;const error_code=analyticsError(error);if(error_code==='permission_denied')emit('microphone_denied',{...props,error_code});emit(flow==='guest'?'try_recording_failed':'recording_failed',{...props,error_code,duration_ms:now()-started})}}
}
