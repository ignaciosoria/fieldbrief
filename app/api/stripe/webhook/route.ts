import {stripeServer} from "../../../../lib/stripeServer"
import {syncSubscription} from "../../../../lib/subscriptionSyncServer"
import {subscriptionEventTarget} from "../../../../lib/subscriptionEvent"

export async function POST(request:Request) {
  const secret=process.env.STRIPE_WEBHOOK_SECRET
  if(!secret) return Response.json({error:"Billing configuration unavailable"},{status:503})
  const signature=request.headers.get("stripe-signature")
  if(!signature) return Response.json({error:"Invalid webhook signature"},{status:400})
  const body=await request.text()
  let stripe
  try {stripe=stripeServer()} catch {return Response.json({error:"Billing configuration unavailable"},{status:503})}
  let event
  try {event=stripe.webhooks.constructEvent(body,signature,secret)} catch {
    return Response.json({error:"Invalid webhook signature"},{status:400})
  }
  try {
    const target=subscriptionEventTarget(event)
    if(target) await syncSubscription(stripe,target.id,target.email)
    return Response.json({received:true})
  } catch {
    return Response.json({error:"Subscription sync failed; retry required"},{status:503})
  }
}
