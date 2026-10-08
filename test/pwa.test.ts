import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'))

test('PWA opens the same app without overriding authentication or trial routing', () => {
  assert.equal(manifest.id, '/')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.name, 'Folup')
  const layout = readFileSync('app/layout.tsx', 'utf8')
  assert.match(layout, /manifest: "\/manifest.json"/)
  assert.match(layout, /appleWebApp:/)
})

test('install icons exist at their declared dimensions with opaque backgrounds', async () => {
  for (const icon of manifest.icons) {
    const metadata = await sharp(`public${icon.src}`).metadata()
    assert.equal(`${metadata.width}x${metadata.height}`, icon.sizes)
    assert.equal(metadata.format, 'png')
    const stats = await sharp(`public${icon.src}`).stats()
    assert.equal(stats.isOpaque, true)
  }
  for (const size of ['192x192', '512x512']) {
    assert.ok(manifest.icons.some((icon: {sizes: string; purpose: string}) => icon.sizes === size && icon.purpose === 'any'))
  }
  assert.ok(manifest.icons.some((icon: {purpose: string}) => icon.purpose === 'maskable'))
  assert.equal((await sharp('app/apple-icon.png').metadata()).width, 180)
})

test('offline hint does not retry requests, reload, or store private content', () => {
  const source = readFileSync('app/components/ConnectivityNotice.tsx', 'utf8')
  assert.match(source, /role="status"/)
  assert.match(source, /removeEventListener\('offline'/)
  assert.doesNotMatch(source, /fetch\(|localStorage|caches\.|serviceWorker|\.reload\(/)
})
