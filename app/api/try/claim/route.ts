import {auth} from '../../../../auth'
import {serverDb} from '../../../../lib/serverDb'
import {guestToken,sameOrigin,tokenHash} from '../../../../lib/guestTryPolicy'
import {scheduleAnalytics} from '../../../../lib/analyticsServer'
export async function POST(request:Request){
  const headers={'Cache-Control':'no-store'}
  if(!sameOrigin(request))return Response.json({error:'Invalid origin.'},{status:403,headers})
  const email=(await auth())?.user?.email?.trim()
  if(!email)return Response.json({error:'Sign in to keep this note.'},{status:401,headers})
  const token=guestToken(request);if(!token)return Response.json({error:'Preview expired.'},{status:410,headers})
  try{
    const {data,error}=await serverDb().rpc('claim_guest_visit',{p_token:tokenHash(token),p_email:email})
    if(error||data?.error||!data?.noteId)throw Error('Claim failed')
    scheduleAnalytics(request,'try_claim_completed',{flow:'guest'},email,`${email}:${data.noteId}`)
    scheduleAnalytics(request,'note_saved',{flow:'guest'},email,`${email}:guest:${data.noteId}`)
    return Response.json(data,{headers})
  }catch{return Response.json({error:'Could not save the preview. Keep this page open and retry.'},{status:503,headers})}
}
