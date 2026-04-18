import { createClient } from '@supabase/supabase-js'

/**
 * Único cliente Supabase del proyecto. Usa las variables tal cual las expone Next.js en el bundle del cliente.
 * Tras cambiar .env.local, reinicia `next dev`.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)

export function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error(
      '[supabase] Falta NEXT_PUBLIC_SUPABASE_URL en .env.local — reinicia el servidor de desarrollo.',
    )
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error(
      '[supabase] Falta NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local — reinicia el servidor de desarrollo.',
    )
  }
}
