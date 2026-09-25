import { parseVisitExtraction } from './visitExtraction'

export type HistoryRow = {id:string;created_at:string;raw_text:string;structured_output:unknown;version?:number}

/** Recover one row in memory only; never overwrite or delete the stored payload. */
export function recoverHistoryRow<T extends {crmText:string;crmFull:string[]}>(
  row:HistoryRow, empty:T, normalize:(input:T)=>T,
) {
  const transcript=typeof row.raw_text==='string'?row.raw_text:''
  const base={id:row.id,date:row.created_at,transcript,version:row.version}
  try {
    const raw=row.structured_output
    if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw Error('Invalid saved output')
    const record=raw as Record<string,unknown>
    if(record.schemaVersion===2) parseVisitExtraction(record.extraction,transcript)
    const result=normalize({...empty,...record})
    // Legacy optional chaining does not protect against numbers/objects in text fields.
    for(const key of Object.keys(empty) as (keyof T)[]) {
      if(typeof empty[key]==='string' && typeof result[key]!=='string') throw Error('Invalid saved text')
    }
    if(!Array.isArray(result.crmFull) || !result.crmFull.every(line=>typeof line==='string')) throw Error('Invalid saved CRM')
    return {...base,result,recoveryRequired:false}
  } catch {
    return {...base,result:{...empty,crmText:transcript,crmFull:transcript?[transcript]:[]},recoveryRequired:true}
  }
}
