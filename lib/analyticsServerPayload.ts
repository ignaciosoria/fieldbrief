import {createHash} from 'node:crypto'
import {analyticsUuid,privatePageview,type AnalyticsEvent} from './analyticsPrivacy'
import {isInternalAnalyticsAccount} from './analyticsInternal'
export function serverAnalyticsPayload(request:Request,event:AnalyticsEvent,properties:Record<string,unknown>,email?:string|null,idempotency?:string){
  if(request.headers.get('dnt')==='1'||request.headers.get('sec-gpc')==='1')return null
  const raw=request.headers.get('x-folup-analytics')
  if(!raw||raw.length>3000)return null
  try{
    const data=JSON.parse(raw)
    if(!analyticsUuid(data.id)||!analyticsUuid(data.properties?.attempt_id)||!analyticsUuid(data.properties?.request_id))return null
    const url=new URL(request.url)
    if(!['www.folup.app','folup.app','localhost','127.0.0.1'].includes(url.hostname))return null
    const h=createHash('sha256').update(JSON.stringify([event,idempotency||data.properties.request_id])).digest('hex')
    const uuid=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`
    return privatePageview({event,uuid,timestamp:new Date(),properties:{...data.properties,...properties,token:undefined,$host:url.hostname,confirmation:'server'}},data.id,
      {...data.context,internal:isInternalAnalyticsAccount(email)||data.context?.internal===true,environment:['localhost','127.0.0.1'].includes(url.hostname)?'test':'production'})
  }catch{return null}
}
