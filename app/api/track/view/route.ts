import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
export async function POST(request: Request) {
  if (!rateLimit(`view:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 30)) return NextResponse.json({ ok: false }, { status: 429 });
  const supabase = getSupabaseAdmin(); if (!supabase) return NextResponse.json({ ok: true });
  const { newsletterId } = await request.json() as { newsletterId?: string }; if (!newsletterId) return NextResponse.json({ ok: false }, { status: 400 });
  await supabase.from("profile_views").insert({ newsletter_id: newsletterId, referrer: request.headers.get("referer")?.slice(0, 500) ?? null });
  await supabase.rpc("increment_profile_views", { newsletter_id: newsletterId });
  return NextResponse.json({ ok: true });
}
