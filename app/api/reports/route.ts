import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function POST(request: Request) {
  if (!rateLimit(`report:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 5)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const body = await request.json().catch(() => null) as { slug?: unknown; reason?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const reason = typeof body?.reason === "string" ? body.reason.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000) : "";
  if (!SAFE_SLUG.test(slug) || reason.length < 10) return NextResponse.json({ error: "INVALID_REPORT" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "REPORT_UNAVAILABLE" }, { status: 503 });
  const newsletter = await supabase.from("newsletters").select("id").eq("slug", slug).maybeSingle();
  if (newsletter.error) return NextResponse.json({ error: "REPORT_UNAVAILABLE" }, { status: 503 });
  const created = await supabase.from("public_listing_reports").insert({ newsletter_id: newsletter.data?.id ?? null, slug, reason });
  if (created.error) return NextResponse.json({ error: "REPORT_UNAVAILABLE" }, { status: 503 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
