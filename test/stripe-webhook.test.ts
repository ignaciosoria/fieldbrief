import assert from 'node:assert/strict'
import {test} from 'node:test'
import Stripe from 'stripe'
import {POST} from '../app/api/stripe/webhook/route'

test('real webhook route verifies signatures and acknowledges irrelevant signed events without network calls',async()=>{
  const oldSecret=process.env.STRIPE_WEBHOOK_SECRET,oldKey=process.env.STRIPE_SECRET_KEY
  const secret='whsec_synthetic_local_test'
  try {
    process.env.STRIPE_WEBHOOK_SECRET=secret
    process.env.STRIPE_SECRET_KEY='sk_test_synthetic_local_test'
    const payload=JSON.stringify({id:'evt_synthetic',object:'event',type:'customer.created',data:{object:{id:'cus_synthetic'}}})
    const request=(signature?:string,body=payload)=>new Request('https://folup.example.test/api/stripe/webhook',{method:'POST',headers:signature?{'stripe-signature':signature}:{},body})
    assert.equal((await POST(request())).status,400)
    assert.equal((await POST(request('invalid'))).status,400)
    const stripe=new Stripe('sk_test_synthetic_local_test')
    const signature=stripe.webhooks.generateTestHeaderString({payload,secret})
    assert.equal((await POST(request(signature,payload+' '))).status,400,'Signature must authenticate the exact raw body')
    const response=await POST(request(signature))
    assert.equal(response.status,200)
    assert.deepEqual(await response.json(),{received:true})
    delete process.env.STRIPE_WEBHOOK_SECRET
    assert.equal((await POST(request(signature))).status,503)
  } finally {
    if(oldSecret===undefined)delete process.env.STRIPE_WEBHOOK_SECRET;else process.env.STRIPE_WEBHOOK_SECRET=oldSecret
    if(oldKey===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=oldKey
  }
})
