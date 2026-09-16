import {createHash} from 'node:crypto'
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import {stripeServer} from '../../../../lib/stripeServer'
import {serverDb} from '../../../../lib/serverDb'
import {grantsPaidAccess} from '../../../../lib/subscriptionPolicy'

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const email=session.user.email.trim()
    const stripe=stripeServer()
    const price=process.env.STRIPE_PRICE_ID
    if(!price) throw Error('Missing price')
    const {data:existing,error}=await serverDb().from('subscriptions').select('stripe_customer_id,stripe_subscription_id').eq('user_id',email).maybeSingle()
    if(error) throw error
    if(existing?.stripe_subscription_id) {
      const subscription=await stripe.subscriptions.retrieve(existing.stripe_subscription_id)
      if(grantsPaidAccess(subscription,price)) return NextResponse.json({error:'You already have an active subscription.',code:'ALREADY_SUBSCRIBED'},{status:409})
    }
    const origin=process.env.NEXTAUTH_URL || 'https://www.folup.app'
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      locale: "en",
      payment_method_types: ["card"],
      line_items: [
        {
          price,
          quantity: 1,
        },
      ],
      ...(existing?.stripe_customer_id ? {customer:existing.stripe_customer_id} : {customer_email:email}),
      success_url: new URL('/?success=true',origin).href,
      cancel_url: new URL('/?canceled=true',origin).href,
      metadata: {user_email:email},
      subscription_data:{metadata:{user_email:email}},
    },{idempotencyKey:createHash('sha256').update(`folup-checkout:en:${email}:${price}:${Math.floor(Date.now()/900000)}`).digest('hex')})

    return NextResponse.json({ url: checkoutSession.url })
  } catch {
    return NextResponse.json({ error: 'Unable to open checkout. Please try again.' }, { status: 503 })
  }
}
