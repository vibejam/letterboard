import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!rateLimit(`confirm:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 12)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const supabase = getSupabaseAdmin();
  const token = new URL(request.url).searchParams.get("token");
  if (!supabase || !token || token.length > 256) return NextResponse.json({ error: "INVALID_VERIFICATION" }, { status: 400 });

  const hash = createHash("sha256").update(token).digest("hex");
  const existing = await supabase.from("ownership_verifications").select("expires_at,used_at").eq("token_hash", hash).maybeSingle();
  if (existing.error || !existing.data) return NextResponse.json({ error: "INVALID_VERIFICATION" }, { status: 400 });
  if (existing.data.used_at || new Date(existing.data.expires_at) < new Date()) return NextResponse.json({ error: "EXPIRED_VERIFICATION" }, { status: 410 });

  const confirmed = await supabase.rpc("confirm_ownership", { p_token_hash: hash });
  if (confirmed.error || !confirmed.data?.[0]) {
    const message = confirmed.error?.message ?? "CONFIRMATION_FAILED";
    if (message.includes("FOUNDING_100_FULL")) return NextResponse.json({ error: "FOUNDING_100_FULL" }, { status: 409 });
    if (message.includes("INVALID_VERIFICATION")) return NextResponse.json({ error: "EXPIRED_VERIFICATION" }, { status: 410 });
    return NextResponse.json({ error: "CONFIRMATION_FAILED" }, { status: 409 });
  }
  return NextResponse.json({ confirmed: true, foundingPosition: confirmed.data[0].founding_position, profileSlug: confirmed.data[0].profile_slug });
}
