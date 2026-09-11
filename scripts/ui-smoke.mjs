/** Isolated browser integration test. All APIs/OAuth/payments/analytics are mocked.
 * No production data or paid calls. Start the local production build on port 3100.
 * Set FOLUP_PLAYWRIGHT_MODULE and FOLUP_CHROME_EXECUTABLE if not locally installed.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { visitExtractionResult } from '../lib/visitExtraction.ts'
const {chromium} = await import(process.env.FOLUP_PLAYWRIGHT_MODULE || 'playwright')
const rows=readFileSync(new URL('../eval/visit-v2-run-5.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse)
const fixture=id=>structuredClone(rows.find(r=>r.id===id).output)
const browser=await chromium.launch({headless:true,executablePath:process.env.FOLUP_CHROME_EXECUTABLE})
try {
  for (const width of [390,1280]) {
    const context=await browser.newContext({viewport:{width,height:900}})
    const notes=new Map();const queue=[];const errors=[];let failSave=true
    await context.route('**/*',async route=>{
      const req=route.request();const url=new URL(req.url())
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
      if(url.origin!=='http://localhost:3100') return route.fulfill({status:200,contentType:req.resourceType()==='script'?'application/javascript':'text/html',body:req.resourceType()==='script'?'':'External navigation intercepted by test'})
      if(url.pathname==='/api/auth/session') return json({user:{name:'Test Rep',email:'synthetic@example.test'},expires:'2099-01-01T00:00:00Z'})
      if(url.pathname==='/api/subscription') return json({active:false})
      if(url.pathname==='/api/notes') {
        if(req.method()==='GET') return json({notes:[...notes.values()].reverse(),hasMore:false})
        if(req.method()==='PUT') {
          if(failSave){failSave=false;return json({error:'Synthetic save failure'},503)}
          const n=req.postDataJSON();notes.set(n.id,{id:n.id,created_at:'2026-09-10T18:00:00Z',raw_text:n.transcript,structured_output:n.result});return json({saved:true})
        }
        throw Error('Unexpected notes mutation')
      }
      if(url.pathname==='/api/structure') {
        assert.ok(queue.length,'Unexpected extraction request')
        return json(visitExtractionResult(queue.shift(),'2026-09-10T18:00:00Z','America/Los_Angeles'))
      }
      if(url.pathname.startsWith('/api/')) throw Error(`Unexpected API: ${url.pathname}`)
      return route.continue()
    })
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
    await page.goto('http://localhost:3100/try')
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
    assert.deepEqual(errors,[])
    console.log(JSON.stringify({viewport:width,passed:true,checks:['save retry','calendar own context','written correction same id','clarification refresh','no invented followup'],mocked:true}))
    await context.close()
  }
} finally {await browser.close()}
