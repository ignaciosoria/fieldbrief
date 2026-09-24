import {serverDb} from './serverDb'
import {sealCalendarToken,openCalendarToken} from './calendarTokenCrypto'
import {hasCalendarScope} from './googleCalendarScope'
import {fetchWithTimeout} from './fetchWithTimeout'

export class CalendarConnectionRequired extends Error {}
const secret=()=>process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || ''
const identity=(email:string,subject:string)=>`google:${email}:${subject}`

export async function storeGoogleCalendarConnection(input:{email:string;subject:string;accessToken:string;refreshToken?:string;expiresAt:number;scope:string}) {
  if(!hasCalendarScope(input.scope)||!input.subject||!input.accessToken||!Number.isFinite(input.expiresAt))return
  const email=input.email.trim().toLowerCase(),db=serverDb()
  const {data:old,error}=await db.from('google_calendar_connections').select('google_subject,refresh_encrypted').eq('user_id',email).maybeSingle()
  if(error)throw Error('Calendar connection unavailable')
  const aad=identity(email,input.subject)
  const {error:writeError}=await db.from('google_calendar_connections').upsert({
    user_id:email,google_subject:input.subject,scope:input.scope,
    access_encrypted:sealCalendarToken(input.accessToken,aad,secret()),
    refresh_encrypted:input.refreshToken?sealCalendarToken(input.refreshToken,aad,secret()):old?.google_subject===input.subject?old.refresh_encrypted:null,
    expires_at:new Date(input.expiresAt*1000).toISOString(),updated_at:new Date().toISOString(),
  },{onConflict:'user_id'})
  if(writeError)throw Error('Calendar connection unavailable')
}

export async function googleCalendarAccessToken(email:string):Promise<string> {
  email=email.trim().toLowerCase()
  const db=serverDb()
  const {data:row,error}=await db.from('google_calendar_connections').select('*').eq('user_id',email).maybeSingle()
  if(error)throw Error('Calendar connection unavailable')
  if(!row || !hasCalendarScope(row.scope))throw new CalendarConnectionRequired()
  const aad=identity(email,row.google_subject)
  if(Date.parse(row.expires_at)>Date.now()+60_000)return openCalendarToken(row.access_encrypted,aad,secret())
  if(!row.refresh_encrypted)throw new CalendarConnectionRequired()
  const response=await fetchWithTimeout('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},cache:'no-store',
    body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,
      grant_type:'refresh_token',refresh_token:openCalendarToken(row.refresh_encrypted,aad,secret())}),
  },10_000)
  const tokens=await response.json()
  if(!response.ok){
    if(tokens.error==='invalid_grant')throw new CalendarConnectionRequired()
    throw Error('Calendar connection unavailable')
  }
  if(typeof tokens.access_token!=='string'||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)throw Error('Invalid token response')
  if(tokens.scope && !hasCalendarScope(tokens.scope))throw new CalendarConnectionRequired()
  const {data:updated,error:writeError}=await db.from('google_calendar_connections').update({
    access_encrypted:sealCalendarToken(tokens.access_token,aad,secret()),
    refresh_encrypted:typeof tokens.refresh_token==='string'?sealCalendarToken(tokens.refresh_token,aad,secret()):row.refresh_encrypted,
    expires_at:new Date(Date.now()+tokens.expires_in*1000).toISOString(),updated_at:new Date().toISOString(),
  }).eq('user_id',email).eq('google_subject',row.google_subject).eq('updated_at',row.updated_at).select('user_id').maybeSingle()
  if(writeError)throw Error('Calendar connection unavailable')
  // A reconnect or another refresh won the race. Never use the stale identity;
  // let a safe retry read the current connection instead of overwriting it.
  if(!updated)throw Error('Calendar connection changed; retry')
  return tokens.access_token
}
