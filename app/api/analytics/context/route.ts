import {auth} from '../../../../auth'
import {isInternalAnalyticsAccount} from '../../../../lib/analyticsInternal'
export async function GET(){
  const session=await auth()
  return Response.json({internal:isInternalAnalyticsAccount(session?.user?.email)},{headers:{'Cache-Control':'no-store'}})
}
