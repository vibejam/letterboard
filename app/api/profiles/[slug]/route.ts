import { NextResponse } from "next/server";
import { getNewsletterClickCount } from "@/lib/board";
import { inferSharePlatformFromCanonicalUrl } from "@/lib/share";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { slug } = await context.params;
  const result = await supabase.from("newsletters").select("id,slug,title,description,logo_url,logo_source,logo_width,logo_height,canonical_url,source_platform,founding_position,founding_tier,ownership_status,boardmark_status").eq("slug", slug).eq("ownership_status", "confirmed").maybeSingle();
  if (result.error || !result.data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const clicks = await getNewsletterClickCount(supabase, result.data.id);
  if (clicks === null) return NextResponse.json({ error: "UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const inferredPlatform = inferSharePlatformFromCanonicalUrl(result.data.canonical_url);
  return NextResponse.json({ profile: { ...result.data, source_platform: result.data.source_platform ?? (inferredPlatform === "unknown" ? null : inferredPlatform), newsletter_clicks: clicks } }, { headers: { "Cache-Control": "no-store" } });
}
