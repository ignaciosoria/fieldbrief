import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PublicLanding from '../app/components/PublicLanding'

test('public landing explains the product and labels sample output as illustrative', () => {
  const html = renderToStaticMarkup(createElement(PublicLanding, { onSignIn() {} }))
  assert.equal((html.match(/<h1\b/g) || []).length, 1)
  assert.match(html, /Every visit/)
  assert.match(html, /Illustrative example/)
  assert.match(html, /No prices/)
  assert.match(html, /Friday · 3:00 PM/)
  assert.match(html, /CRM note ready to copy/)
  assert.match(html, /You choose what goes into your calendar/)
  assert.match(html, /href="\/try"/)
  assert.match(html, /href="#how-it-works"/)
  assert.match(html, /id="how-it-works"/)
  assert.doesNotMatch(html, /folup-shell|folup-bottom-nav|calendar.google.com|Record 30 seconds/)
})

test('both real sign-in buttons use the existing auth callback; preview has no fake buttons', () => {
  let calls = 0
  const tree = PublicLanding({ onSignIn: () => { calls++ } })
  const buttons: ReactElement<{ onClick: () => void; type: string }>[] = []
  function walk(node: ReactNode) {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node || typeof node !== 'object' || !('props' in node)) return
    const element = node as ReactElement<{ children?: ReactNode; onClick: () => void; type: string }>
    if (element.type === 'button') buttons.push(element)
    walk(element.props.children)
  }
  walk(tree)
  assert.equal(buttons.length, 2)
  for (const button of buttons) {
    assert.equal(button.props.type, 'button')
    button.props.onClick()
  }
  assert.equal(calls, 2)
})
