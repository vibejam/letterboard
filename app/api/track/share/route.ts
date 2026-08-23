import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
export async function POST(request: Request) {
  if (!rateLimit(`share:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 20)) return NextResponse.json({ ok: false }, { status: 429 });
  const { newsletterId, channel } = await request.json() as { newsletterId?: string; channel?: string };
  if (!newsletterId || !channel || !['copy','web_share','x','linkedin','download'].includes(channel)) return NextResponse.json({ ok: false }, { status: 400 });
  const supabase = getSupabaseAdmin(); if (supabase) await supabase.from("share_events").insert({ newsletter_id: newsletterId, channel });
  return NextResponse.json({ ok: true });
}
