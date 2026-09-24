import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import AuthErrorPage from '../app/auth/error/page'

test('auth failure offers a local, explicit recovery path with no automatic consent or event write',()=>{
  const html=renderToStaticMarkup(React.createElement(AuthErrorPage))
  assert.match(html,/We couldn’t complete your Google connection/)
  assert.match(html,/15 minutes/)
  assert.match(html,/href="\/"/)
  assert.match(html,/Connecting alone does not create an event/)
  assert.doesNotMatch(html,/Server error|Check the server logs|https:\/\/|<script/)
})
test('custom recovery is wired without disabling OAuth checks or extending their lifetime',()=>{
  const auth=readFileSync('auth.ts','utf8')
  assert.match(auth,/error: '\/auth\/error'/)
  assert.doesNotMatch(auth,/checks:|cookies:|maxAge:|skipCSRFCheck/)
  const page=readFileSync('app/auth/error/page.tsx','utf8')
  assert.doesNotMatch(page,/searchParams|useEffect|signIn\(|fetch\(/)
})
