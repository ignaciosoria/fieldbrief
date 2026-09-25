import {auth} from '../../../../auth'
import {serverDb} from '../../../../lib/serverDb'
import {googleCalendarAccessToken} from '../../../../lib/googleCalendarConnection'
import {calendarActionStates,saveLinkedCalendarEvent} from '../../../../lib/calendarActionServer'
import {handleCalendarSave} from '../../../../lib/calendarSaveHandler'

export const runtime='nodejs'
export async function POST(request:Request) {
  return handleCalendarSave(request,{
    getEmail:async()=>(await auth())?.user?.email?.trim()||null,
    ownsNote:async(email,id)=>{
      const {data,error}=await serverDb().from('folup_notes').select('id').eq('user_id',email).eq('id',id).maybeSingle()
      if(error)throw Error('Unable to verify note ownership')
      return !!data
    },
    getToken:googleCalendarAccessToken,save:saveLinkedCalendarEvent,
  })
}

export async function GET(request:Request) {
  const email=(await auth())?.user?.email?.trim()
  if(!email)return Response.json({error:'Sign in to view follow-ups.'},{status:401})
  const id=new URL(request.url).searchParams.get('noteId') || ''
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return Response.json({error:'Invalid note.'},{status:400})
  try {return Response.json({actions:await calendarActionStates(email,id)},{headers:{'Cache-Control':'no-store'}})}
  catch{return Response.json({error:'Could not load calendar status.'},{status:503})}
}
