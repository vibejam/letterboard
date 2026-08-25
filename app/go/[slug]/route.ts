import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { safeRedirectUrl } from "@/lib/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { slug } = await context.params;
  const result = await supabase.from("newsletters").select("id,canonical_url").eq("slug", slug).eq("ownership_status", "confirmed").maybeSingle();
  if (result.error || !result.data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const destination = safeRedirectUrl(result.data.canonical_url);
  if (!destination) return NextResponse.json({ error: "UNSAFE_DESTINATION" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const referrer = safeRedirectUrl(request.headers.get("referer"))?.slice(0, 500) ?? null;
  const click = await supabase.from("newsletter_clicks").insert({ newsletter_id: result.data.id, referrer });
  if (click.error) return NextResponse.json({ error: "UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.redirect(destination, { status: 307, headers: { "Cache-Control": "no-store" } });
}
