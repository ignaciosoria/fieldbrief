import type Stripe from 'stripe'
import {stripeObjectId} from './subscriptionPolicy'

/** Call only after Stripe signature verification. No ownership from billing/customer email. */
export function subscriptionEventTarget(event:Stripe.Event):{id:string;email?:string}|null {
  if(event.type==='checkout.session.completed' || event.type==='checkout.session.async_payment_succeeded') {
    const session=event.data.object
    if(session.mode!=='subscription') return null
    const id=stripeObjectId(session.subscription)
    return id?{id,email:session.metadata?.user_email}:null
  }
  if(['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed'].includes(event.type)) {
    return {id:(event.data.object as Stripe.Subscription).id}
  }
  if(['invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.finalization_failed'].includes(event.type)) {
    const invoice=event.data.object as Stripe.Invoice
    const id=stripeObjectId(invoice.parent?.subscription_details?.subscription)
    return id?{id}:null
  }
  return null
}
