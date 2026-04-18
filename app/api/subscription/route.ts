import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { createServiceRoleClient } from "../../../lib/supabase"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ active: false })
    }

    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("subscriptions")
      .select("status")
      .eq("user_id", session.user.email)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ active: false })
    }

    if (!data) {
      return NextResponse.json({ active: false })
    }

    return NextResponse.json({
      active: data.status === "active",
    })
  } catch {
    return NextResponse.json({ active: false })
  }
}
