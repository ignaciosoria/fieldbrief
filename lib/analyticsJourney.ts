import {safeCampaign,analyticsUuid,type Campaign,type Source} from './analyticsPrivacy'
export const JOURNEY_TTL=30*86400_000
export const SESSION_TTL=30*60_000
export const SIGNIN_TTL=15*60_000
export type Journey={id:string;expires:number;first:Campaign;last:Campaign;signinPending?:boolean;signin?:{id:string;at:number;sent?:boolean};session?:{id:string;at:number;source:Source;campaign:Campaign};firstSource?:Source;visitorType?:'new'|'returning'}
export function restoreJourney(raw:unknown,now:number,newId:()=>string):Journey {
  const v=raw as Partial<Journey>|null
  if(v && typeof v.id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.id) && typeof v.expires==='number' && v.expires>now && v.expires<=now+JOURNEY_TTL)
    return {id:v.id,expires:v.expires,first:safeCampaign(v.first),last:safeCampaign(v.last),signinPending:v.signinPending===true,
      ...(v.signin&&analyticsUuid(v.signin.id)&&Number.isFinite(v.signin.at)&&v.signin.at<=now?{signin:{id:v.signin.id,at:v.signin.at,sent:v.signin.sent===true}}:{}),
      ...(v.session&&analyticsUuid(v.session.id)&&Number.isFinite(v.session.at)&&v.session.at<=now?{session:{...v.session,campaign:safeCampaign(v.session.campaign),source:safeSource(v.session.source)}}:{}),
      firstSource:v.firstSource?safeSource(v.firstSource):safeCampaign(v.first).utm_campaign?'apollo':'unknown',visitorType:v.session&&now-v.session.at<SESSION_TTL&&v.visitorType==='new'?'new':'returning'}
  return {id:newId(),expires:now+JOURNEY_TTL,first:{},last:{}}
}
function safeSource(v:unknown):Source{return ['direct','apollo','search','referral','unknown'].includes(String(v))?v as Source:'unknown'}
export function arrivalSource(campaign:Campaign,referrer:string):Source {
  if(campaign.utm_source==='apollo')return 'apollo'
  if(!referrer)return 'direct'
  try{const host=new URL(referrer).hostname
    if(['folup.app','www.folup.app','accounts.google.com'].includes(host))return 'direct'
    return /(^|\.)(google\.[a-z.]+|bing.com|duckduckgo.com)$/.test(host)?'search':'referral'
  }catch{return 'unknown'}
}
export function touchJourney(journey:Journey,campaign:Campaign,source:Source,now:number,newId:()=>string):Journey {
  const fresh=!journey.session||now-journey.session.at>=SESSION_TTL
  const attributed=attributeJourney(journey,campaign)
  return {...attributed,firstSource:journey.firstSource||source,
    // A direct first touch stays direct; later campaigns are session/last-touch only.
    first:journey.firstSource?journey.first:attributed.first,
    visitorType:fresh?(journey.session||journey.visitorType==='returning'?'returning':'new'):journey.visitorType||'new',
    session:fresh?{id:newId(),at:now,source,campaign:safeCampaign(campaign)}:{...journey.session!,at:now}}
}
export function attributeJourney(journey:Journey,campaign:Campaign):Journey {
  const safe=safeCampaign(campaign)
  return safe.utm_campaign?{...journey,first:journey.first.utm_campaign?journey.first:safe,last:safe}:journey
}
