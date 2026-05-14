/**
 * Run structure API smoke tests against a local dev server.
 * Usage: node test/run-notes.mjs
 * Requires: npm run dev on http://localhost:3000 (and a valid OPENAI_API_KEY on the server)
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'output.html')
const API = 'http://localhost:3000/api/structure'

const TEST_NOTES = [
  {
    label: 'typical 1 / call after visit',
    text: "Just left Dave Martinez at Central Coast Farms, good meeting. He's got about 150 acres of strawberries in Santa Maria. Interested in trying Quantum Flower this season but wants to talk to his agronomist first. Call him Thursday to follow up.",
  },
  {
    label: 'typical 2 / send after call',
    text: "Called Jennifer at Sunrise Nursery this morning. She's looking for something to improve fruit size on her navel oranges, about 80 acres. Asked me to send her the Quantum Engorde technical sheet and pricing by end of day today.",
  },
]

function esc(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatAdditionalSteps(steps) {
  if (!Array.isArray(steps)) return ''
  if (steps.length === 0) return '—'
  return JSON.stringify(steps, null, 0)
}

function rowClass(data) {
  const next = (data?.nextStep || '').trim()
  const conf = data?.nextStepConfidence || ''
  const bad = !next || conf === 'low'
  return bad ? ' class="row-warn"' : ''
}

async function run() {
  const results = []
  const clientNow = Date.now()

  for (const t of TEST_NOTES) {
    let payload = { error: 'No response' }
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: t.text,
          timezone: 'America/Chicago',
          clientNow,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        payload = { error: json.error || res.statusText || String(res.status), raw: json.raw }
      } else {
        payload = json
      }
    } catch (e) {
      payload = { error: e?.message || String(e) }
    }
    results.push({ ...t, payload })
  }

  const rows = results
    .map((r) => {
      const p = r.payload
      if (p.error) {
        return `<tr class="row-warn">
  <td><span class="tag">${esc(r.label)}</span><pre class="note">${esc(r.text)}</pre></td>
  <td colspan="11" class="err">Error: ${esc(p.error)}${p.raw != null ? `<pre>${esc(String(p.raw).slice(0, 2000))}</pre>` : ''}</td>
</tr>`
      }
      const flags = Array.isArray(p.ambiguityFlags) ? p.ambiguityFlags.join(', ') : '—'
      return `<tr${rowClass(p)}>
  <td><span class="tag">${esc(r.label)}</span><pre class="note">${esc(r.text)}</pre></td>
  <td>${esc(p.contact)}</td>
  <td>${esc(p.customer)}</td>
  <td>${esc(p.nextStep)}</td>
  <td>${esc(p.nextStepTitle)}</td>
  <td>${esc(p.nextStepDate)}</td>
  <td>${esc(p.nextStepSoftTiming)}</td>
  <td><pre class="json">${esc(formatAdditionalSteps(p.additionalSteps))}</pre></td>
  <td>${esc(p.nextStepConfidence)}</td>
  <td>${esc(flags)}</td>
  <td><pre class="json">${esc(p.calendarDescription ?? '')}</pre></td>
  <td><pre class="json">${esc(JSON.stringify(p.commercialContext, null, 2))}</pre></td>
</tr>`
    })
    .join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Structure API test output</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; background: #fafafa; color: #111; }
    h1 { font-size: 1.25rem; }
    p.meta { color: #6b7280; font-size: 0.9rem; }
    table { border-collapse: collapse; width: 100%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    th, td { border: 1px solid #e5e7eb; padding: 0.5rem 0.6rem; vertical-align: top; font-size: 0.8rem; }
    th { background: #f4f4f5; text-align: left; font-weight: 600; }
    pre.note { white-space: pre-wrap; margin: 0.35rem 0 0; font-size: 0.75rem; line-height: 1.4; }
    pre.json { margin: 0; font-size: 0.7rem; white-space: pre-wrap; max-width: 28rem; }
    .tag { display: inline-block; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; color: #4f46e5; font-weight: 700; margin-bottom: 0.25rem; }
    tr.row-warn { background: #fef2f2; }
    tr.row-warn td { border-color: #fecaca; }
    td.err { color: #b91c1c; }
  </style>
</head>
<body>
  <h1>Structure API — <code>test/run-notes.mjs</code></h1>
  <p class="meta">Generated at ${esc(new Date().toISOString())} · POST ${esc(API)}</p>
  <p class="meta">Rows with empty <code>nextStep</code> or <code>nextStepConfidence: low</code> are highlighted in red.</p>
  <table>
    <thead>
      <tr>
        <th>Original note</th>
        <th>contact</th>
        <th>customer</th>
        <th>nextStep</th>
        <th>nextStepTitle</th>
        <th>nextStepDate</th>
        <th>nextStepSoftTiming</th>
        <th>additionalSteps</th>
        <th>confidence</th>
        <th>ambiguityFlags</th>
        <th>calendarDescription</th>
        <th>commercialContext</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`

  mkdirSync(__dirname, { recursive: true })
  writeFileSync(OUT, html, 'utf8')
  console.log('Wrote', OUT)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
