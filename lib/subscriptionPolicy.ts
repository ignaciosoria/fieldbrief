import type Stripe from 'stripe'

export function hasCurrentPaidAccess(subscription:{status:string|null;paid_until:string|null}|null,now=Date.now()):boolean {
  return subscription?.status==='active' && !!subscription.paid_until && Date.parse(subscription.paid_until)>now
}

/** Active correct-price subscriptions only; paused collection must not grant unlimited AI. */
export function grantsPaidAccess(subscription:Pick<Stripe.Subscription,'status'|'pause_collection'|'items'>, priceId:string):boolean {
  return !!priceId && subscription.status==='active' && !subscription.pause_collection &&
    subscription.items.data.some(item=>item.price.id===priceId && (item.quantity || 0)>0)
}

export function stripeObjectId(value:string|{id:string}|null|undefined):string|null {
  return typeof value==='string' ? value : value?.id || null
}

export function paidAccessUntil(subscription:Parameters<typeof grantsPaidAccess>[0] & Pick<Stripe.Subscription,'latest_invoice'>,priceId:string,now=Date.now()):string|null {
  if(!grantsPaidAccess(subscription,priceId)) return null
  // An active subscription can still have a draft/unpaid invoice (e.g. tax finalization failure).
  const invoice=subscription.latest_invoice
  if(!invoice || typeof invoice==='string' || invoice.status!=='paid') return null
  const end=Math.max(0,...subscription.items.data.filter(item=>item.price.id===priceId && (item.quantity || 0)>0).map(item=>item.current_period_end))
  return Number.isFinite(end) && end*1000>now ? new Date(end*1000).toISOString() : null
}
