import { createClient } from '@supabase/supabase-js'

/**
 * Must be prefixed with NEXT_PUBLIC_ so Next.js inlines them into the browser bundle.
 * After changing .env.local, restart `next dev` / rebuild.
 */
export const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
export const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  if (!supabaseUrl) {
    console.error(
      '[supabase] NEXT_PUBLIC_SUPABASE_URL no está definida o está vacía. Añádela en .env.local y reinicia el servidor.',
    )
  }
  if (!supabaseAnonKey) {
    console.error(
      '[supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY no está definida o está vacía. Usa la anon key del proyecto (Settings → API). Reinicia el servidor.',
    )
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
