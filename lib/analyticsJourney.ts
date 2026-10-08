import {safeCampaign,type Campaign} from './analyticsPrivacy'
export const JOURNEY_TTL=30*86400_000
export type Journey={id:string;expires:number;first:Campaign;last:Campaign;signinPending?:boolean}
export function restoreJourney(raw:unknown,now:number,newId:()=>string):Journey {
  const v=raw as Partial<Journey>|null
  if(v && typeof v.id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.id) && typeof v.expires==='number' && v.expires>now && v.expires<=now+JOURNEY_TTL)
    return {id:v.id,expires:v.expires,first:safeCampaign(v.first),last:safeCampaign(v.last),signinPending:v.signinPending===true}
  return {id:newId(),expires:now+JOURNEY_TTL,first:{},last:{}}
}
export function attributeJourney(journey:Journey,campaign:Campaign):Journey {
  const safe=safeCampaign(campaign)
  return safe.utm_campaign?{...journey,first:journey.first.utm_campaign?journey.first:safe,last:safe}:journey
}
