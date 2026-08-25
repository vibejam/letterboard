import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { safeExternalUrl } from "@/lib/urls";
export async function POST(request: Request) {
  if (!rateLimit(`share:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 20)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await request.json().catch(() => null) as { newsletterId?: unknown; channel?: unknown; shareUrl?: unknown } | null;
  const newsletterId = body?.newsletterId;
  const channel = body?.channel;
  const shareUrl = body?.shareUrl;
  const safeUrl = typeof shareUrl === "string" ? safeExternalUrl(shareUrl) : null;
  const safeHost = safeUrl ? new URL(safeUrl).hostname.toLowerCase() : "";
  const validId = typeof newsletterId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(newsletterId);
  const validChannel = typeof channel === "string" && ["copy", "web_share", "substack", "medium", "x", "linkedin", "unknown"].includes(channel);
  if (!validId || !validChannel || (safeUrl && !["letterboard.lol", "www.letterboard.lol"].includes(safeHost))) return NextResponse.json({ ok: false }, { status: 400 });
  const supabase = getSupabaseAdmin(); if (supabase) await supabase.from("share_events").insert({ newsletter_id: newsletterId as string, channel: channel as string, ...(safeUrl ? { share_url: safeUrl } : {}) });
  return NextResponse.json({ ok: true });
}
