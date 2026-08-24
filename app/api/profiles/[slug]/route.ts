import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const { slug } = await context.params;
  const result = await supabase.from("newsletters").select("id,slug,title,description,logo_url,canonical_url,source_platform,founding_position,founding_tier,profile_views,ownership_status,boardmark_status").eq("slug", slug).eq("ownership_status", "confirmed").maybeSingle();
  if (result.error || !result.data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ profile: result.data });
}
