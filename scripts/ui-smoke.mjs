/** Isolated browser integration test. All APIs/OAuth/payments/analytics are mocked.
 * No production data or paid calls. Start the local production build on port 3100.
 * Set FOLUP_PLAYWRIGHT_MODULE and FOLUP_CHROME_EXECUTABLE if not locally installed.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { visitExtractionResult } from '../lib/visitExtraction.ts'
const {chromium} = await import(process.env.FOLUP_PLAYWRIGHT_MODULE || 'playwright')
const baseUrl=process.env.FOLUP_TEST_BASE_URL || 'http://localhost:3100'
if(!['localhost','127.0.0.1'].includes(new URL(baseUrl).hostname)) throw Error('Smoke tests only permit a local application')
const rows=readFileSync(new URL('../eval/visit-v2-run-5.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse)
const fixture=id=>structuredClone(rows.find(r=>r.id===id).output)
const browser=await chromium.launch({headless:true,executablePath:process.env.FOLUP_CHROME_EXECUTABLE})
try {
  for (const width of [390,1280]) {
    const context=await browser.newContext({viewport:{width,height:900}})
    const notes=new Map();const queue=[];const errors=[];let failSave=true;let failStructure=false
    let transcribeCalls=0;let rejectOversize=false;const structureBodies=[]
    await context.addInitScript(()=>{
      window.__micStops=0
      Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>{window.__micStops++}}]})},configurable:true})
      window.MediaRecorder=class {
        static isTypeSupported(){return true}
        constructor(){if(window.__failRecorder)throw Error('Synthetic recorder failure');this.mimeType='audio/webm';this.state='inactive'}
        start(){this.state='recording'}
        stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['synthetic-audio'],{type:this.mimeType})});this.onstop?.()}
      }
    })
    await context.route('**/*',async route=>{
      const req=route.request();const url=new URL(req.url())
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
      if(url.origin!==new URL(baseUrl).origin) return route.fulfill({status:200,contentType:req.resourceType()==='script'?'application/javascript':'text/html',body:req.resourceType()==='script'?'':'External navigation intercepted by test'})
      if(url.pathname==='/api/auth/session') return json({user:{name:'Test Rep',email:'synthetic@example.test'},expires:'2099-01-01T00:00:00Z'})
      if(url.pathname==='/api/subscription') return json({active:false})
      if(url.pathname==='/api/transcribe') {
        transcribeCalls++
        if(rejectOversize) return route.fulfill({status:413,contentType:'text/html',body:'Payload too large'})
        if(transcribeCalls===1) return json({error:'Synthetic audio upload failure'},503)
        return json({transcript:'Visité a Ana de Acme. Mañana tengo que llamarla.'})
      }
      if(url.pathname==='/api/notes') {
        if(req.method()==='GET') return json({notes:[...notes.values()].reverse(),hasMore:false})
        if(req.method()==='PUT') {
          if(failSave){failSave=false;return json({error:'Synthetic save failure'},503)}
          const n=req.postDataJSON();notes.set(n.id,{id:n.id,created_at:'2026-09-10T18:00:00Z',raw_text:n.transcript,structured_output:n.result});return json({saved:true})
        }
        throw Error('Unexpected notes mutation')
      }
      if(url.pathname==='/api/structure') {
        structureBodies.push(req.postDataJSON())
        if(failStructure) {failStructure=false;return json({error:'Synthetic structure failure'},503)}
        assert.ok(queue.length,'Unexpected extraction request')
        return json(visitExtractionResult(queue.shift(),'2026-09-10T18:00:00Z','America/Los_Angeles'))
      }
      if(url.pathname.startsWith('/api/')) throw Error(`Unexpected API: ${url.pathname}`)
      return route.continue()
    })
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
    await page.goto(`${baseUrl}/try`)
    const process=async id=>{
      queue.push(fixture(id))
      await page.getByPlaceholder('Or type a note…').fill(rows.find(r=>r.id===id)?.output.summary || 'Synthetic note')
      await page.getByRole('button',{name:'Process Note',exact:true}).click()
    }
    await process('es-two-companies')
    await page.getByRole('button',{name:'Retry saving',exact:true}).click()
    await page.getByRole('heading',{name:'Nota para CRM',exact:true}).waitFor()
    await page.waitForFunction(()=>!document.body.innerText.includes('Retry saving'))
    assert.equal(notes.size,1)
    const popupPromise=page.waitForEvent('popup')
    await page.getByRole('button',{name:'+ Add',exact:true}).click()
    const popup=await popupPromise;await popup.waitForLoadState()
    const url=new URL(popup.url());assert.match(url.searchParams.get('text'),/Luis.*Beta/)
    assert.doesNotMatch(url.searchParams.get('details'),/Ana|Acme/)
    await popup.close()
    await page.getByText('Corregir por escrito',{exact:true}).click()
    const changed=fixture('es-two-companies');changed.actions[1].company='Gamma';changed.companies[1]='Gamma';changed.summary=changed.summary.replace('Beta','Gamma')
    queue.push(changed)
    await page.getByLabel('¿Qué quieres cambiar?').fill('La empresa de Luis es Gamma, no Beta.')
    await page.getByRole('button',{name:'Aplicar corrección',exact:true}).click()
    await page.getByText(/Luis — Gamma: Llamar/).waitFor()
    assert.equal(notes.size,1,'Correction must update, not duplicate a note')
    await page.getByRole('button',{name:'New',exact:true}).click()
    await process('es-uncertain-person')
    await page.getByRole('dialog').waitFor()
    await page.getByLabel('Tu respuesta').fill('María')
    queue.push(fixture('es-confirmed-person'))
    await page.getByRole('button',{name:'Confirmar',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'hidden'})
    await page.getByRole('heading',{name:'Nota para CRM',exact:true}).waitFor()
    assert.equal(notes.size,2)
    assert.ok([...notes.values()].some(n=>n.structured_output.extraction.actions[0].contact==='María'))
    await page.getByRole('button',{name:'New',exact:true}).click()
    await process('es-no-followup')
    await page.getByRole('heading',{name:'Nota para CRM',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Add to calendar',exact:true}).count(),0)
    assert.equal(notes.size,3)

    // Answer one ambiguity, leave the other unresolved, and retry a failed refresh.
    await page.getByRole('button',{name:'New',exact:true}).click()
    const partial=fixture('es-uncertain-person')
    partial.actions[0].date='';partial.actions[0].time=''
    partial.questions.push({action_index:0,field:'date',question:'¿Qué día quieres llamar?'})
    queue.push(partial)
    await page.getByPlaceholder('Or type a note…').fill('Hablé con Marta o María. Tengo que llamarla, no sé qué día.')
    await page.getByRole('button',{name:'Process Note',exact:true}).click()
    await page.getByLabel('Tu respuesta').fill('María')
    await page.getByRole('button',{name:'Confirmar',exact:true}).click()
    await page.getByRole('heading',{name:'¿Qué día quieres llamar?',exact:true}).waitFor()
    assert.equal(queue.length,0,'Collecting intermediate answers needs no API call')
    failStructure=true
    await page.getByRole('button',{name:'Dejar pendiente',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'Tus respuestas siguen aquí'}).waitFor()
    assert.equal(notes.size,3,'Failed refresh must not persist stale prose')
    const refreshed=fixture('es-confirmed-person')
    refreshed.actions[0].date='';refreshed.actions[0].time=''
    refreshed.questions=[{action_index:0,field:'date',question:'¿Qué día quieres llamar?'}]
    queue.push(refreshed)
    await page.getByRole('button',{name:'Dejar pendiente',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'hidden'})
    await page.getByRole('heading',{name:'Nota para CRM',exact:true}).waitFor()
    assert.equal(notes.size,4)
    const savedPartial=[...notes.values()].at(-1)
    assert.equal(savedPartial.structured_output.extraction.actions[0].contact,'María')
    assert.equal(savedPartial.structured_output.extraction.actions[0].date,'')
    assert.doesNotMatch(savedPartial.structured_output.extraction.summary,/Marta/)
    assert.equal(savedPartial.structured_output.extraction.questions.length,1)
    assert.match(savedPartial.raw_text,/María/)

    // Escape before answering anything saves the unresolved result without paid work.
    await page.getByRole('button',{name:'New',exact:true}).click()
    await process('es-uncertain-person')
    await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({state:'hidden'})
    await page.getByRole('heading',{name:'Nota para CRM',exact:true}).waitFor()
    assert.equal(notes.size,5)
    assert.equal(queue.length,0)

    // Fake microphone only: failed ASR retains downloadable audio, then a failed
    // extraction is retried from text without paying for another transcription.
    await page.getByRole('button',{name:'New',exact:true}).click()
    await page.getByRole('button',{name:'Record visit',exact:true}).click()
    await page.getByRole('button',{name:'Stop recording',exact:true}).click()
    await page.getByRole('region',{name:'Recover recording'}).waitFor()
    assert.equal(transcribeCalls,1)
    assert.equal(await page.evaluate(()=>window.__micStops),1)
    assert.equal(await page.getByRole('button',{name:'Record visit',exact:true}).isDisabled(),true)
    const downloadPromise=page.waitForEvent('download')
    await page.getByRole('link',{name:'Download audio',exact:true}).click()
    const download=await downloadPromise
    assert.equal(download.suggestedFilename(),'folup-recording.webm')
    assert.equal(await download.failure(),null)
    failStructure=true
    await page.getByRole('button',{name:'Retry recording',exact:true}).click()
    await page.getByText('Synthetic structure failure',{exact:true}).waitFor()
    assert.equal(transcribeCalls,2)
    const firstAudioStructure=structureBodies.at(-1)
    assert.equal(await page.getByRole('region',{name:'Recover recording'}).count(),0)
    assert.equal(await page.getByPlaceholder('Or type a note…').inputValue(),'Visité a Ana de Acme. Mañana tengo que llamarla.')
    queue.push(fixture('es-two-companies'))
    await page.getByRole('button',{name:'Process Note',exact:true}).click()
    await page.getByRole('heading',{name:'Nota para CRM',exact:true}).waitFor()
    assert.equal(transcribeCalls,2,'Successful ASR is not repeated after extraction fails')
    assert.equal(structureBodies.at(-1).clientNow,firstAudioStructure.clientNow,'Retry retains original visit timestamp')
    assert.equal(structureBodies.at(-1).timezone,firstAudioStructure.timezone)
    assert.equal(notes.size,6)

    // Constructor failure releases the acquired mic; HTML upload errors retain audio.
    await page.getByRole('button',{name:'New',exact:true}).click()
    await page.evaluate(()=>{window.__failRecorder=true})
    await page.getByRole('button',{name:'Record visit',exact:true}).click()
    await page.getByText('Synthetic recorder failure',{exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>window.__micStops),2)
    assert.equal(transcribeCalls,2)
    await page.evaluate(()=>{window.__failRecorder=false})
    rejectOversize=true
    await page.getByRole('button',{name:'Record visit',exact:true}).click()
    await page.getByRole('button',{name:'Stop recording',exact:true}).click()
    await page.getByRole('region',{name:'Recover recording'}).waitFor()
    await page.getByText('The recording is too large to upload. Download a copy before discarding it.',{exact:true}).waitFor()
    page.once('dialog',dialog=>dialog.accept())
    await page.getByRole('button',{name:'Discard recording',exact:true}).click()
    await page.getByRole('region',{name:'Recover recording'}).waitFor({state:'hidden'})
    assert.equal(await page.getByRole('button',{name:'Record visit',exact:true}).isEnabled(),true)
    assert.equal(notes.size,6)
    assert.deepEqual(errors,[])
    console.log(JSON.stringify({viewport:width,passed:true,checks:['save retry','calendar own context','written correction same id','clarification refresh','no invented followup','partial clarification skip with failed refresh retry','escape without unnecessary refresh','failed audio download and retry','text-only retry preserves visit timestamp','constructor failure releases mic','HTML 413 recovery and explicit discard'],mocked:true}))
    await context.close()
  }
} finally {await browser.close()}
