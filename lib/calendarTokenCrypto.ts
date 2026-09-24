import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto'

function key(secret:string) {
  if(secret.length<16)throw Error('Calendar encryption unavailable')
  return Buffer.from(hkdfSync('sha256',secret,'folup-calendar-v1','oauth-token-storage',32))
}
/** Tokens stay server-side, encrypted and bound to the verified Google identity. */
export function sealCalendarToken(value:string,identity:string,secret:string):string {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv)
  cipher.setAAD(Buffer.from(identity))
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()])
  return ['v1',iv.toString('base64url'),encrypted.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.')
}
export function openCalendarToken(value:string,identity:string,secret:string):string {
  const [version,iv,data,tag,...extra]=value.split('.')
  if(version!=='v1'||!iv||!data||!tag||extra.length)throw Error('Invalid encrypted token')
  const cipher=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(iv,'base64url'))
  cipher.setAAD(Buffer.from(identity));cipher.setAuthTag(Buffer.from(tag,'base64url'))
  return Buffer.concat([cipher.update(Buffer.from(data,'base64url')),cipher.final()]).toString('utf8')
}
