import Link from 'next/link'

export default function NotFound(){
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
    <p className="text-sm font-semibold text-indigo-600">FOLUP · 404</p>
    <h1 className="mt-4 text-3xl font-semibold">This page took a wrong turn.</h1>
    <p className="mt-4 text-gray-600">The link may have changed. Your next visit is a good place to start.</p>
    <Link href="/try" className="mt-8 rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white">Try your own visit</Link>
    <Link href="/" className="mt-4 text-indigo-700">Back to Folup</Link>
    <a href="mailto:ignacio.isk@gmail.com" className="mt-8 text-sm text-gray-600 underline">Contact support</a>
  </main>
}
