import Stripe from 'stripe'
export function stripeServer() {
  if (!process.env.STRIPE_SECRET_KEY) throw Error('Billing configuration unavailable')
  return new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2026-03-25.dahlia',timeout:10000,maxNetworkRetries:1})
}
