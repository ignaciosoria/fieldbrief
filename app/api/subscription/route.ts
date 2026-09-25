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
    const { data, error } = await supabase.rpc('get_trial_status', {
      p_user_id: session.user.email.trim(),
    })

    if (error || !data || typeof data.active !== 'boolean' || typeof data.ended !== 'boolean') throw error || new Error('Invalid access response')

    return NextResponse.json({
      active: data.active,
      trial: {startedAt:data.startedAt,endsAt:data.endsAt,ended:data.ended},
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Unable to verify your subscription. Please try again.' }, { status: 503 })
  }
}
