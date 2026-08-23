import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ stats: { claimed: 0, total: 100 }, top: [], rows: [], activity: [] });
  const [board, activity] = await Promise.all([
    supabase.from("newsletters").select("id,slug,title,description,canonical_url,source_platform,founding_position,profile_views,ownership_status").eq("ownership_status", "confirmed").not("founding_position", "is", null).order("founding_position", { ascending: true }),
    supabase.from("activity_events").select("id,event_type,created_at,newsletters(title)").eq("approved", true).order("created_at", { ascending: false }).limit(8),
  ]);
  if (board.error) return NextResponse.json({ error: "BOARD_UNAVAILABLE" }, { status: 503 });
  return NextResponse.json({ stats: { claimed: board.data.length, total: 100 }, top: board.data.slice(0, 3), rows: board.data.slice(3), activity: activity.data ?? [] });
}
