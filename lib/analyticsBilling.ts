import {safeCampaign,analyticsUuid,type Campaign,type Source} from './analyticsPrivacy'

export type BillingAnalytics={id:string;first:Campaign;last:Campaign;sessionCampaign?:Campaign;sessionId?:string;firstSource?:Source;sessionSource?:Source;visitorType?:'new'|'returning';internal?:boolean}
const source=(v:unknown):Source|undefined=>['direct','apollo','search','referral','unknown'].includes(String(v))?v as Source:undefined
export function billingAnalytics(value:unknown):BillingAnalytics|undefined {
  if(!value||typeof value!=='object')return
  const v=value as Record<string,unknown>
  if(typeof v.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.id))return
  return {id:v.id,first:safeCampaign(v.first),last:safeCampaign(v.last),
    ...(analyticsUuid(v.sessionId)?{sessionId:v.sessionId}:{}),
    ...(v.sessionCampaign?{sessionCampaign:safeCampaign(v.sessionCampaign)}:{}),
    ...(source(v.firstSource)?{firstSource:source(v.firstSource)}:{}),
    ...(source(v.sessionSource)?{sessionSource:source(v.sessionSource)}:{}),
    ...(v.visitorType==='new'||v.visitorType==='returning'?{visitorType:v.visitorType}:{}),
    ...(typeof v.internal==='boolean'?{internal:v.internal}:{})}
}
export function analyticsMetadata(value:unknown,internal=false):Record<string,string> {
  const safe=billingAnalytics(value)
  if(!safe)return {}
  const {id,first,last,...context}=safe
  // Stripe limits each metadata value to 500 characters. Keep the legacy key readable.
  return {folup_analytics:JSON.stringify({id,first,last}),folup_analytics_context:JSON.stringify({...context,internal:internal||safe.internal===true})}
}
export function analyticsFromMetadata(value:unknown,contextValue?:unknown):BillingAnalytics|undefined {
  if(typeof value!=='string'||value.length>500)return
  try{
    const base=billingAnalytics(JSON.parse(value));if(!base)return
    if(contextValue===undefined)return base
    if(typeof contextValue!=='string'||contextValue.length>500)return
    const context=JSON.parse(contextValue)
    return billingAnalytics({...context,...base})
  }catch{return}
}
