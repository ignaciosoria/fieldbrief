import sharp from 'sharp'

// Reuse the existing brand asset; opaque backgrounds also work on iOS.
for (const [path, size, ratio] of [
  ['public/pwa-192.png', 192, 0.8],
  ['public/pwa-512.png', 512, 0.8],
  ['public/pwa-maskable-512.png', 512, 0.6],
  ['app/apple-icon.png', 180, 0.8],
]) {
  const mark = await sharp('public/logo.png').resize(Math.round(size * ratio)).toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } })
    .composite([{ input: mark, gravity: 'centre' }]).png().toFile(path)
}
