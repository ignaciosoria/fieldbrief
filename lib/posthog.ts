import posthog from 'posthog-js'
import {campaignFromParams,privateAnalyticsConfig,privatePageview,analyticsUuid,type AnalyticsEvent,type AnalyticsContext} from './analyticsPrivacy'
import {restoreJourney,touchJourney,arrivalSource,SIGNIN_TTL,type Journey} from './analyticsJourney'

const STORAGE='folup-analytics-v1', OPT_OUT='folup-analytics-disabled', INTERNAL='folup-analytics-internal'
let journey:Journey|undefined, initialized=false, sdkReady=false
let internal:boolean|undefined, contextRequest:Promise<void>|undefined, lastPage:string|undefined
let queue:Array<{event:AnalyticsEvent;properties:Record<string,unknown>;context:AnalyticsContext;at:Date}>=[], signinLock=false
let generation=0
let contextRetryAt=0
export function analyticsDisabled() {
  if(typeof window==='undefined')return true
  try{return localStorage.getItem(OPT_OUT)==='1'||navigator.doNotTrack==='1'||(navigator as Navigator & {globalPrivacyControl?:boolean}).globalPrivacyControl===true}catch{return true}
}
function persist(){try{if(journey)localStorage.setItem(STORAGE,JSON.stringify(journey))}catch{}}
function capture(event:AnalyticsEvent,properties:Record<string,unknown>,at?:Date){
  posthog.capture(event,properties,{...(at?{timestamp:at}:{}),...(event==='signin_started'||event==='try_cta_clicked'?{send_instantly:true}:{}),...(event==='signin_started'&&analyticsUuid(properties.attempt_id)?{uuid:properties.attempt_id}:{})})
  if(event==='signin_started'&&journey?.signin&&journey.signin.id===properties.attempt_id){journey.signin.sent=true;persist()}
}
function context():AnalyticsContext {return {first:journey?.first,last:journey?.last,sessionCampaign:journey?.session?.campaign,sessionId:journey?.session?.id,firstSource:journey?.firstSource,sessionSource:journey?.session?.source,visitorType:journey?.visitorType,internal:internal===true||localStorage.getItem(INTERNAL)==='1',environment:'production'}}
function touch(){if(!journey)return;const campaign=campaignFromParams(new URLSearchParams(location.search));journey=touchJourney(journey,campaign,arrivalSource(campaign,document.referrer),Date.now(),()=>crypto.randomUUID());persist()}
export function initPosthog(){
  if(typeof window==='undefined'||initialized||analyticsDisabled()||process.env.NODE_ENV!=='production'||!['www.folup.app','folup.app'].includes(location.hostname))return
  const key=process.env.NEXT_PUBLIC_POSTHOG_KEY;if(!key)return
  try{
    let raw;try{raw=JSON.parse(localStorage.getItem(STORAGE)||'null')}catch{raw=null}
    journey=restoreJourney(raw,Date.now(),()=>crypto.randomUUID());touch()
    const config={api_host:process.env.NEXT_PUBLIC_POSTHOG_HOST||'https://us.i.posthog.com',...privateAnalyticsConfig(journey.id),
      before_send:(event:Parameters<typeof privatePageview>[0])=>analyticsDisabled()||!journey?null:privatePageview(event,journey.id,event?.properties._folup_context||context())}
    if(sdkReady)posthog.set_config(config);else{posthog.init(key,config);sdkReady=true}
    initialized=true
    void refreshAnalyticsContext()
  }catch{/* Analytics must never block the product. */}
}
/** No profile identification. Only an authenticated server-side internal-traffic flag. */
export async function refreshAnalyticsContext(){
  if(analyticsDisabled()||!initialized)return
  if(contextRequest)return contextRequest
  internal=undefined
  const version=generation
  contextRequest=(async()=>{
    try{
      const response=await fetch('/api/analytics/context',{cache:'no-store',signal:AbortSignal.timeout(5000)})
      if(!response.ok)throw Error('Unavailable')
      const data=await response.json();if(typeof data.internal!=='boolean')throw Error('Invalid')
      if(version!==generation)return
      internal=data.internal
      contextRetryAt=0
      if(internal)localStorage.setItem(INTERNAL,'1')
      if(analyticsDisabled()){queue=[];return}
      const pending=queue;queue=[];for(const item of pending)capture(item.event,{...item.properties,_folup_context:{...item.context,internal:context().internal}},item.at)
      // A fast OAuth navigation can happen before the context request finishes.
      if(journey?.signin&&!journey.signin.sent&&Date.now()-journey.signin.at<SIGNIN_TTL)capture('signin_started',{attempt_id:journey.signin.id,$pathname:location.pathname,$host:location.hostname,_folup_context:context()},new Date(journey.signin.at))
    }catch{if(version===generation){queue=[];contextRetryAt=Date.now()+30_000}/* Fail closed: do not count unresolved internal traffic. */}
    finally{if(version===generation)contextRequest=undefined}
  })()
  return contextRequest
}
export function track(event:AnalyticsEvent,properties:Record<string,unknown>={}){
  try{
    initPosthog();if(!initialized||analyticsDisabled())return
    touch()
    const props={flow:event.startsWith('demo_')||event.startsWith('example_')?'demo':location.pathname==='/try'?'guest':'app',...properties,$pathname:location.pathname,$host:location.hostname}
    if(internal===undefined){
      const safe=privatePageview({event,uuid:crypto.randomUUID(),properties:props},journey!.id,context())
      if(safe&&queue.length<100)queue.push({event,properties:safe.properties,context:context(),at:new Date()})
      if(!contextRequest&&Date.now()>=contextRetryAt)void refreshAnalyticsContext()
      return
    }
    capture(event,{...props,_folup_context:context()})
  }catch{}
}
export function trackPageview(path:string){if(lastPage===path)return;lastPage=path;track('$pageview')}
export function trackSigninStart(){
  // Guard the actual click handler too, even when analytics is off.
  if(signinLock)return false;signinLock=true
  if(typeof window!=='undefined')window.addEventListener('pagehide',()=>{signinLock=false},{once:true})
  initPosthog()
  if(journey&&!analyticsDisabled()){
    if(journey.signin)track('signin_result_unobserved',{attempt_id:journey.signin.id})
    journey.signin={id:crypto.randomUUID(),at:Date.now()};persist()
    track('signin_started',{attempt_id:journey.signin.id})
  }
  return true
}
export function trackSigninComplete(){
  signinLock=false
  initPosthog();if(!journey?.signin)return
  const pending=journey.signin;delete journey.signin;delete journey.signinPending;persist()
  track('signin_completed',{attempt_id:pending.id,confirmation:'server',duration_ms:Date.now()-pending.at})
}
export function trackSigninFailure(){signinLock=false;if(!journey?.signin)return;const id=journey.signin.id;delete journey.signin;persist();track('signin_failed',{attempt_id:id,error_code:'auth_error'})}
export function expireSignin(){if(journey?.signin&&Date.now()-journey.signin.at>SIGNIN_TTL){const id=journey.signin.id;delete journey.signin;persist();track('signin_result_unobserved',{attempt_id:id})}}
export function analyticsHeaders(attemptId:string,properties:Record<string,unknown>={},requestId:string=analyticsUuid(properties.request_id)?properties.request_id:crypto.randomUUID()):Record<string,string>{
  try{initPosthog();if(!journey||analyticsDisabled()||internal===undefined)return {};touch()
    const safe=privatePageview({event:'note_processing_started',uuid:requestId,properties:{...properties,attempt_id:attemptId,request_id:requestId,$pathname:location.pathname,$host:location.hostname}},journey.id,context())
    return safe?{'x-folup-analytics':JSON.stringify({id:journey.id,context:context(),properties:safe.properties})}:{}
  }catch{return {}}
}
export function analyticsCheckout(){initPosthog();return !analyticsDisabled()&&journey&&internal===false&&localStorage.getItem(INTERNAL)!=='1'?{id:journey.id,first:journey.first,last:journey.last}:undefined}
export function clearAnalyticsJourney(){try{localStorage.removeItem(STORAGE)}catch{}generation++;contextRetryAt=0;contextRequest=undefined;journey=undefined;initialized=false;internal=undefined;queue=[];lastPage=undefined;signinLock=false;try{posthog.reset()}catch{}}
export function setAnalyticsDisabled(disabled:boolean){try{localStorage.setItem(OPT_OUT,disabled?'1':'0')}catch{}if(disabled)clearAnalyticsJourney();else{initPosthog();trackPageview(location.pathname)}window.dispatchEvent(new Event('folup-analytics-change'))}
/** QA can enable before login; server account marking works across signed-in devices. */
export function setAnalyticsInternal(value:boolean){try{localStorage.setItem(INTERNAL,value?'1':'0')}catch{}}
export default posthog
