import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { supabase } from "../../../lib/supabase"

export async function GET() {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ active: false })
  }

  const { data } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", session.user.email)
    .single()

  return NextResponse.json({ active: data?.status === "active" })
}
