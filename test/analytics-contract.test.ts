import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {analyticsEvents} from '../lib/analyticsPrivacy'
test('prepared funnels reference real events, exclude internal traffic and keep calendar optional',()=>{
  const config=JSON.parse(readFileSync('docs/analytics-funnels.json','utf8'))
  assert.equal(config.filters.is_internal,false);assert.equal(config.filters.environment,'production')
  for(const funnel of config.funnels)for(const step of funnel.steps){assert.ok(analyticsEvents.includes(step.event));assert.notEqual(step.event,'calendar_saved')}
  assert.ok(config.funnels.some((f:{name:string})=>f.name.startsWith('Guest first')))
})
test('successful processing and save have one server source, privacy features are not activated',()=>{
  const home=readFileSync('app/page.tsx','utf8'),guest=readFileSync('app/components/LiveTry.tsx','utf8')
  assert.doesNotMatch(home,/track\('note_processed'/);assert.doesNotMatch(guest,/track\('try_processing_completed'/)
  assert.match(readFileSync('app/api/structure/route.ts','utf8'),/scheduleAnalytics\(request,'note_processed'/)
  assert.match(readFileSync('app/api/notes/route.ts','utf8'),/expectedVersion===0\?'note_saved':'note_updated'/)
  assert.match(readFileSync('lib/analyticsServer.ts','utf8'),/VERCEL_ENV!=='production'/)
})
