import assert from 'node:assert/strict'
import {test,mock} from 'node:test'
import posthog,{analyticsCheckout,clearAnalyticsJourney,initPosthog,refreshAnalyticsContext,setAnalyticsDisabled,track,trackSigninStart,trackSigninComplete,trackSigninFailure,trackPageview,analyticsHeaders,readyAnalyticsHeaders,readyAnalyticsCheckout,setAnalyticsInternal} from '../lib/posthog'

test('client analytics respects privacy, excludes previews, survives storage failures and counts OAuth once',async()=>{
  const names=['window','localStorage','navigator','location','document']
  const original=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]))
  const env={NODE_ENV:process.env.NODE_ENV,NEXT_PUBLIC_POSTHOG_KEY:process.env.NEXT_PUBLIC_POSTHOG_KEY}
  const values=new Map<string,string>()
  const storage={getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}}
  const nav={doNotTrack:'0',globalPrivacyControl:false}
  const location={hostname:'localhost',pathname:'/',search:'?utm_source=apollo&utm_medium=email&utm_campaign=ag_field_pilot'}
  const events:string[]=[]
  const init=mock.method(posthog,'init',()=>undefined)
  mock.method(posthog,'set_config',()=>{})
  mock.method(posthog,'reset',()=>{})
  mock.method(posthog,'capture',(event:string)=>{events.push(event);return undefined})
  mock.method(globalThis,'fetch',async(input:unknown)=>{assert.equal(input,'/api/analytics/context');return Response.json({internal:false})})
  try {
    for(const [key,value] of Object.entries({window:new EventTarget(),localStorage:storage,navigator:nav,location,document:{referrer:''}}))Object.defineProperty(globalThis,key,{value,configurable:true})
    Object.assign(process.env,{NODE_ENV:'production',NEXT_PUBLIC_POSTHOG_KEY:'test-key'})
    initPosthog();assert.equal(init.mock.callCount(),0,'localhost is excluded')
    location.hostname='www.folup.app';nav.globalPrivacyControl=true
    track('demo_started');assert.equal(events.length,0,'GPC is honored')
    nav.globalPrivacyControl=false;nav.doNotTrack='1'
    initPosthog();assert.equal(init.mock.callCount(),0,'DNT is honored')
    nav.doNotTrack='0';values.set('folup-analytics-v1','broken json')
    trackSigninStart();assert.equal(trackSigninStart(),false);trackSigninComplete();trackSigninComplete()
    await refreshAnalyticsContext()
    assert.deepEqual(events,['signin_started','signin_completed'])
    const attribution=analyticsCheckout()!
    assert.equal(attribution.first.utm_campaign,'ag_field_pilot')
    assert.match(attribution.id,/^[0-9a-f-]{36}$/)
    setAnalyticsDisabled(true);track('demo_started')
    assert.equal(analyticsCheckout(),undefined);assert.equal(events.length,2)
    assert.equal(values.has('folup-analytics-v1'),false)
    setAnalyticsDisabled(false);await refreshAnalyticsContext();assert.notEqual(analyticsCheckout()?.id,attribution.id)
    trackSigninStart();trackSigninFailure();assert.equal(trackSigninStart(),true,'failed login unlocks a real retry');trackSigninComplete()
    assert.equal(events.filter(e=>e==='signin_failed').length,1)
    assert.equal(events.filter(e=>e==='signin_completed').length,2)
    events.length=0
    clearAnalyticsJourney();initPosthog();await refreshAnalyticsContext()
    trackPageview('/');trackPageview('/');location.pathname='/try';trackPageview('/try');location.pathname='/';trackPageview('/')
    assert.deepEqual(events,['$pageview','$pageview','$pageview'],'route changes count; duplicate mount does not')
    setAnalyticsInternal(true)
    assert.equal(JSON.parse(analyticsHeaders(crypto.randomUUID())['x-folup-analytics']).context.internal,true)
    assert.equal(analyticsCheckout(),undefined,'internal checkout is not a campaign conversion')
    clearAnalyticsJourney()
    setAnalyticsInternal(false)
    let resolveContext!:(response:Response)=>void
    mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>{resolveContext=resolve}))
    const attempt=crypto.randomUUID()
    let completed=false
    const pendingHeaders=readyAnalyticsHeaders(attempt).then(headers=>{completed=true;return headers})
    const pendingCheckout=readyAnalyticsCheckout()
    await Promise.resolve()
    assert.equal(completed,false,'quick submits wait for the internal traffic check')
    resolveContext(Response.json({internal:false}))
    const header=JSON.parse((await pendingHeaders)['x-folup-analytics'])
    assert.equal(header.properties.attempt_id,attempt)
    assert.equal(header.context.internal,false)
    assert.equal((await pendingCheckout)?.id,header.id,'checkout and server events share the journey')
    clearAnalyticsJourney()
    const optedOut=readyAnalyticsHeaders(attempt)
    setAnalyticsDisabled(true)
    resolveContext(Response.json({internal:false}))
    assert.deepEqual(await optedOut,{},'opting out during the check suppresses attribution')
    values.delete('folup-analytics-disabled')
    storage.getItem=()=>{throw Error('Storage denied')}
    assert.doesNotThrow(()=>track('note_processed'))
    assert.equal(analyticsCheckout(),undefined)
  }finally{
    clearAnalyticsJourney();mock.restoreAll()
    for(const name of names){const descriptor=original[name];if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name)}
    for(const [key,value] of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value}
  }
})
