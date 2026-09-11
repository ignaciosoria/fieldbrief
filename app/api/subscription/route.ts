import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { serverDb } from "../../../lib/serverDb"
import { hasCurrentPaidAccess } from "../../../lib/subscriptionPolicy"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Sign in to check your subscription.' }, { status: 401 })
    }

    const supabase = serverDb()
    const { data, error } = await supabase
      .from("subscriptions")
      .select("status,paid_until")
      .eq("user_id", session.user.email.trim())
      .maybeSingle()

    if (error) throw error

    return NextResponse.json({
      active: hasCurrentPaidAccess(data),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Unable to verify your subscription. Please try again.' }, { status: 503 })
  }
}
