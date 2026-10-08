import {safeCampaign,type Campaign} from './analyticsPrivacy'

export type BillingAnalytics={id:string;first:Campaign;last:Campaign}
export function billingAnalytics(value:unknown):BillingAnalytics|undefined {
  if(!value||typeof value!=='object')return
  const v=value as Record<string,unknown>
  if(typeof v.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.id))return
  return {id:v.id,first:safeCampaign(v.first),last:safeCampaign(v.last)}
}
export function analyticsMetadata(value:unknown):Record<string,string> {
  const safe=billingAnalytics(value)
  return safe?{folup_analytics:JSON.stringify(safe)}:{}
}
export function analyticsFromMetadata(value:unknown):BillingAnalytics|undefined {
  if(typeof value!=='string'||value.length>500)return
  try{return billingAnalytics(JSON.parse(value))}catch{return}
}
