import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PublicDemo, { DEMO_CRM } from '../app/components/PublicDemo'
import { demoSamples, sampleCrm } from '../lib/publicDemoSamples'

test('public demo starts without login and clearly identifies the illustrative sample', () => {
  const html = renderToStaticMarkup(createElement(PublicDemo, {onSignIn() {}, onStart() {}, onComplete() {}}))
  assert.match(html, /No recording, AI request or account needed/)
  assert.match(html, /Illustrative sample/)
  assert.doesNotMatch(html, /See what Folup picks up|View full result|Replay the reveal|↗/)
  assert.match(html, /Send spec sheet to Maya/)
  assert.match(html, /Check the technical review with Maya/)
  assert.match(html, /Why this move/)
  assert.match(html, /CRM note, ready to go/)
  assert.match(html, /Try with your own visit/)
  assert.doesNotMatch(html, /mk-insight|mk-legend/)
  assert.match(html, /no prices/)
  assert.doesNotMatch(html, /Processing|Add to calendar|Record visit/)
})
test('sample CRM distinguishes commitment and recommendation without inventing a sale', () => {
  assert.match(DEMO_CRM, /No trial or order has been agreed/)
  assert.match(DEMO_CRM, /No prices/)
  assert.match(DEMO_CRM, /Proposed follow-up/)
  assert.match(DEMO_CRM, /Friday · 3:00 PM · proposed schedule/)
})

test('samples preserve requests not to act and do not invent commitments', () => {
  assert.equal(demoSamples.length, 3)
  const waiting = demoSamples[1]
  assert.equal(waiting.recommendation, undefined)
  assert.match(sampleCrm(waiting), /Do not send samples/)
  assert.doesNotMatch(sampleCrm(waiting), /Proposed follow-up:/)
  const interest = demoSamples[2]
  assert.equal(interest.commitment, undefined)
  assert.doesNotMatch(sampleCrm(interest), /Next steps:/)
  assert.match(sampleCrm(interest), /Proposed follow-up:/)
  for (const sample of demoSamples) {
    assert.match(sampleCrm(sample), /AM|PM/)
    assert.ok(sample.fragments.some(fragment => fragment.kind === 'person'))
  }
})
