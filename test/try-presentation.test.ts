import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import VisitMicrophone from '../app/components/VisitMicrophone'
import TrialSignInDialog from '../app/components/TrialSignInDialog'

test('app and Try share the original microphone; recording keeps stop semantics',async()=>{
 const app=await readFile('app/page.tsx','utf8'),guest=await readFile('app/components/LiveTry.tsx','utf8')
 for(const source of [app,guest])assert.match(source,/<VisitMicrophone/)
 assert.match(guest,/Tell Folup what happened\. See what to do next\./)
 assert.doesNotMatch(guest,/One visit free|Get my next steps|Record your recap/)
 const html=renderToStaticMarkup(createElement(VisitMicrophone,{isRecording:true,onClick(){}}))
 assert.match(html,/Stop recording/);assert.match(html,/h-36 w-36/)
})
test('calendar gate offers only Google sign-in, trial reassurance and dismiss',()=>{
 const html=renderToStaticMarkup(createElement(TrialSignInDialog,{onSignIn(){},onClose(){}}))
 assert.match(html,/Sign in with Google/);assert.match(html.replace(/<[^>]*>/g,''),/14 days free · No credit card/)
 for(const color of ['#4285F4','#34A853','#FBBC05','#EA4335'])assert.ok(html.includes(color))
 assert.match(html,/Not now/);assert.doesNotMatch(html,/Subscribe|Upgrade|\$19|checkout/i)
})
