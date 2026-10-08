import {createHash,createHmac,randomBytes} from 'node:crypto'

export const GUEST_COOKIE='folup_try'
export const MAX_GUEST_BODY=4_050_000
export function guestCookieOptions(request:Request){
  const url=new URL(request.url)
  return {httpOnly:true,secure:url.protocol==='https:',sameSite:'lax' as const,path:'/',maxAge:30*86400,
    ...(['folup.app','www.folup.app'].includes(url.hostname)?{domain:'folup.app'}:{})}
}
export function guestToken(request:Request){
  const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(GUEST_COOKIE+'='))?.slice(GUEST_COOKIE.length+1)
  return token && /^[a-f0-9]{64}$/.test(token)?token:null
}
export function newGuestToken(){return randomBytes(32).toString('hex')}
export function tokenHash(token:string){return createHash('sha256').update(token).digest('hex')}
export function sameOrigin(request:Request){return request.headers.get('origin')===new URL(request.url).origin}
export function guestNetwork(request:Request){
  const secret=process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if(!secret)throw Error('Missing guest protection secret')
  // Only trust the platform-controlled header on Vercel. Never trust arbitrary X-Forwarded-For.
  const ip=process.env.VERCEL==='1'?request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim():
    process.env.NODE_ENV==='development'?'local-development':null
  if(!ip)throw Error('Trusted network identity unavailable')
  return createHmac('sha256',secret).update(new Date().toISOString().slice(0,10)+':'+ip).digest('hex')
}
export async function boundedGuestRequest(request:Request){
  if(Number(request.headers.get('content-length'))>MAX_GUEST_BODY)throw Error('SIZE')
  const reader=request.body?.getReader();if(!reader)throw Error('EMPTY')
  const chunks:Uint8Array[]=[];let size=0
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_GUEST_BODY){void reader.cancel();throw Error('SIZE')}chunks.push(value)}}finally{reader.releaseLock()}
  const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length}
  return new Request(request.url,{method:'POST',headers:request.headers,body})
}
