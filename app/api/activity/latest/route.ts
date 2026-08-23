import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ activity: [] });
  const result = await supabase.from("activity_events").select("id,event_type,created_at,newsletters(title,slug)").eq("approved", true).order("created_at", { ascending: false }).limit(20);
  if (result.error) return NextResponse.json({ error: "ACTIVITY_UNAVAILABLE" }, { status: 503 });
  return NextResponse.json({ activity: result.data });
}
