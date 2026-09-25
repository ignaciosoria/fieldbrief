export const VISIT_DAYPARTS = ['morning','afternoon','night','unspecified','ambiguous'] as const
export type VisitDaypart = typeof VISIT_DAYPARTS[number]

/** Resolved semantic timing wins. Evidence parsing exists only for pre-v3 saved notes. */
export function resolveVisitTime(action:{time:string;daypart?:VisitDaypart;evidence?:string}) {
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(action.time)) return {time:action.time,suggested:false,needsClarification:false}
  let daypart=action.daypart
  if(daypart===undefined){
    const quote=(action.evidence || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    const afternoon=/\b(?:por la tarde|en la tarde|a la tarde|esta tarde|afternoon)\b/.test(quote)
    const night=/\b(?:por la noche|en la noche|a la noche|esta noche|evening|tonight|at night)\b/.test(quote)
    const morning=/\b(?:por la manana|en la manana|a la manana|esta manana|morning)\b/.test(quote)
    daypart=Number(afternoon)+Number(night)+Number(morning)>1?'ambiguous':night?'night':afternoon?'afternoon':morning?'morning':'unspecified'
  }
  if(daypart==='ambiguous')return {time:'',suggested:false,needsClarification:true}
  return {time:daypart==='afternoon'?'15:00':daypart==='night'?'19:00':'09:00',suggested:true,needsClarification:false}
}
