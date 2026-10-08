# Folup installable web app

This is an online-first installation layer, not an offline replica of Folup.

- `/manifest.json` is linked from the root layout. Installation opens `/` on the current origin; existing authentication and guest routing are unchanged.
- Standalone display, 192/512 PNG icons, a separate maskable icon and a 180px Apple touch icon reuse the existing brand asset.
- Regenerate icons with `node scripts/generate-pwa-icons.mjs` (Sharp is provided by Next.js).
- No service worker, request interception, notification permission, offline cache or background resubmission is introduced. Private API responses are not copied into a PWA cache.
- An offline status notice appears in the loaded app when the browser reports lost connectivity. It does not guarantee server availability or preserve a recording across closing the app. Existing recording recovery remains unchanged.
- No install popup or extra CTA is added.

## Release checks

Run `node --import tsx --test test/*.test.ts`, `npx tsc --noEmit`, and `npm run build`.
Check `/try` and `/` include the manifest and Apple metadata, and icon URLs return PNGs.

After deployment, verify on a real device:

1. iPhone Safari: open `https://www.folup.app`, Share → Add to Home Screen; enable Open as Web App if offered.
2. Open the installed icon; confirm branding and standalone display.
3. Sign in with Google; confirm return to Folup and retained session. A separate sign-in from Safari may be needed depending on the OS.
4. Record a short synthetic note after granting microphone permission. Keep the app foregrounded during recording.
5. Add a test event once and verify date, time and content. Delete only the known test event afterward.
6. With the app already open, disconnect and reconnect; confirm the notice clears and no request or event is replayed automatically.
7. Android Chrome: install from the browser menu and repeat the same checks.

Native installation, OAuth return and microphone behaviour require actual device testing; desktop metadata checks do not prove these flows.
