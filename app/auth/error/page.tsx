import Link from 'next/link'

// Public recovery screen: never reflect provider errors, callback codes or a
// caller-supplied redirect. A retry must start a new, fully checked OAuth flow.
export default function AuthErrorPage() {
  return <main className="flex min-h-dvh items-center justify-center bg-white px-6 py-12">
    <section className="w-full max-w-sm space-y-5 text-center">
      <p className="text-xl font-semibold text-indigo-600">folup</p>
      <h1 className="text-2xl font-semibold text-gray-900">We couldn’t complete your Google connection</h1>
      <p className="text-sm leading-relaxed text-gray-600">The connection may have expired or been interrupted. Return to Folup and try again in the same browser, completing the Google steps within 15 minutes.</p>
      <Link href="/" className="block rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">Return to Folup</Link>
      <p className="text-xs leading-relaxed text-gray-500">For Calendar, open your saved note in History and tap Add to calendar again. Connecting alone does not create an event.</p>
      <p className="text-xs text-gray-500">If it keeps happening, contact support.</p>
    </section>
  </main>
}
