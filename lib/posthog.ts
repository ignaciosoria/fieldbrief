import posthog from 'posthog-js'
import {campaignFromParams, privateAnalyticsConfig, type AnalyticsEvent} from './analyticsPrivacy'
import {restoreJourney,attributeJourney,type Journey} from './analyticsJourney'

const STORAGE='folup-analytics-v1'
const OPT_OUT='folup-analytics-disabled'
let journey:Journey|undefined
let initialized=false
let sdkReady=false

export function analyticsDisabled() {
  if(typeof window==='undefined')return true
  try {return localStorage.getItem(OPT_OUT)==='1' || navigator.doNotTrack==='1' || (navigator as Navigator & {globalPrivacyControl?:boolean}).globalPrivacyControl===true} catch {return true}
}
function persist(){try{if(journey)localStorage.setItem(STORAGE,JSON.stringify(journey))}catch{/* Never interrupt the app. */}}
export function initPosthog() {
  if(typeof window==='undefined'||initialized||analyticsDisabled()||process.env.NODE_ENV!=='production'||!['www.folup.app','folup.app'].includes(location.hostname))return
  const key=process.env.NEXT_PUBLIC_POSTHOG_KEY
  if(!key)return
  try {
    let raw
    try{raw=JSON.parse(localStorage.getItem(STORAGE)||'null')}catch{raw=null}
    journey=restoreJourney(raw,Date.now(),()=>crypto.randomUUID())
    const campaign=campaignFromParams(new URLSearchParams(location.search))
    journey=attributeJourney(journey,campaign)
    persist()
    const privacy=privateAnalyticsConfig(journey.id,{first:journey.first,last:journey.last,environment:'production'})
    const filter=privacy.before_send
    const config={api_host:process.env.NEXT_PUBLIC_POSTHOG_HOST||'https://us.i.posthog.com',...privacy,
      before_send:typeof filter==='function'?((event:Parameters<typeof filter>[0])=>analyticsDisabled()?null:filter(event)):filter}
    if(sdkReady)posthog.set_config(config)
    else{posthog.init(key,config);sdkReady=true}
    initialized=true
  }catch{/* Analytics must never prevent recording, authentication or checkout. */}
}
export function track(event:AnalyticsEvent,properties:Record<string,unknown>={}) {
  try{initPosthog();if(initialized&&!analyticsDisabled())posthog.capture(event,{...properties,$pathname:location.pathname})}catch{}
}
export function trackSigninStart(){track('signin_started');if(journey){journey.signinPending=true;persist()}}
export function trackSigninComplete(){initPosthog();if(journey?.signinPending){journey.signinPending=false;persist();track('signin_completed')}}
export function analyticsCheckout(){initPosthog();return !analyticsDisabled()&&journey?{id:journey.id,first:journey.first,last:journey.last}:undefined}
export function clearAnalyticsJourney(){try{localStorage.removeItem(STORAGE)}catch{}journey=undefined;initialized=false;try{posthog.reset()}catch{}}
export function setAnalyticsDisabled(disabled:boolean){try{localStorage.setItem(OPT_OUT,disabled?'1':'0')}catch{}if(disabled)clearAnalyticsJourney();else initPosthog();window.dispatchEvent(new Event('folup-analytics-change'))}

export default posthog
