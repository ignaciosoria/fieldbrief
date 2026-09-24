import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { serverDb } from "../../../lib/serverDb"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Sign in to check your subscription.' }, { status: 401 })
    }

    const supabase = serverDb()
    const { data, error } = await supabase.rpc('has_unlimited_ai_access', {
      p_user_id: session.user.email.trim(),
    })

    if (error || typeof data !== 'boolean') throw error || new Error('Invalid access response')

    return NextResponse.json({
      active: data,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Unable to verify your subscription. Please try again.' }, { status: 503 })
  }
}
