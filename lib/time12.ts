/** Presentation only. Storage and Calendar keep unambiguous HH:mm. */
export function formatTime12(value:string){
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))return ''
  const [h,m]=value.split(':');const hour=Number(h)
  return `${hour%12||12}:${m} ${hour<12?'AM':'PM'}`
}
export function timeFrom12(hour:string,minute:string,period:string){
  if(!/^(?:[1-9]|1[0-2])$/.test(hour)||! /^[0-5]\d$/.test(minute)||!['AM','PM'].includes(period))return ''
  return `${String(Number(hour)%12+(period==='PM'?12:0)).padStart(2,'0')}:${minute}`
}
