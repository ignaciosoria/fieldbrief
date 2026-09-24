import {auth} from '../../../../auth'
import {serverDb} from '../../../../lib/serverDb'
import {googleCalendarAccessToken} from '../../../../lib/googleCalendarConnection'
import {saveGoogleCalendarEvent} from '../../../../lib/googleCalendarEvent'
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
    getToken:googleCalendarAccessToken,save:saveGoogleCalendarEvent,
  })
}
