import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PublicDemo, { DEMO_CRM } from '../app/components/PublicDemo'

test('public demo starts without login and clearly identifies the illustrative sample', () => {
  const html = renderToStaticMarkup(createElement(PublicDemo, {onSignIn() {}, onStart() {}, onComplete() {}}))
  assert.match(html, /No account needed/)
  assert.match(html, /illustrative example, not a live recording/)
  assert.match(html, /Show the result/)
  assert.match(html, /no prices/)
  assert.doesNotMatch(html, /Processing|Add to calendar|Record visit/)
})
test('sample CRM distinguishes commitment and recommendation without inventing a sale', () => {
  assert.match(DEMO_CRM, /No trial or order has been agreed/)
  assert.match(DEMO_CRM, /without pricing/)
  assert.match(DEMO_CRM, /Proposed follow-up/)
  assert.match(DEMO_CRM, /Friday, 3:00 PM \(proposed schedule\)/)
})
