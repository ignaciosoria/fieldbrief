import type Stripe from 'stripe'
import {serverDb} from './serverDb'
import {paidAccessUntil,stripeObjectId} from './subscriptionPolicy'

/** Refetch current Stripe state instead of trusting possibly delayed event snapshots. */
export async function syncSubscription(stripe:Stripe,id:string,checkoutEmail?:string) {
  const checkedAt=new Date().toISOString()
  const subscription=await stripe.subscriptions.retrieve(id)
  const db=serverDb()
  let email=subscription.metadata?.user_email || checkoutEmail
  if(!email) {
    const {data,error}=await db.from('subscriptions').select('user_id').eq('stripe_subscription_id',id).maybeSingle()
    if(error) throw error
    email=data?.user_id
  }
  // Ignore subscriptions not created for this app; never infer ownership from billing email.
  if(!email) return
  const customerId=stripeObjectId(subscription.customer)
  if(!customerId) throw Error('Missing Stripe customer')
  const paidUntil=paidAccessUntil(subscription,process.env.STRIPE_PRICE_ID || '')
  const {error}=await db.rpc('sync_subscription_status',{
    p_user_id:email.trim(),p_customer_id:customerId,p_subscription_id:id,
    p_status:paidUntil?'active':'inactive',
    p_subscription_created:subscription.created,p_checked_at:checkedAt,p_paid_until:paidUntil,
  })
  if(error) throw error // Stripe must retry; never acknowledge a lost database write.
}
