import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!rateLimit(`confirm:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 12)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const supabase = getSupabaseAdmin();
  const token = new URL(request.url).searchParams.get("token");
  if (!supabase || !token) return NextResponse.json({ error: "INVALID_VERIFICATION" }, { status: 400 });
  const hash = createHash("sha256").update(token).digest("hex");
  const found = await supabase.from("ownership_verifications").select("id,claim_id,expires_at,used_at,claims(newsletter_id)").eq("token_hash", hash).maybeSingle();
  if (found.error || !found.data) return NextResponse.json({ error: "INVALID_VERIFICATION" }, { status: 400 });
  if (found.data.used_at || new Date(found.data.expires_at) < new Date()) return NextResponse.json({ error: "EXPIRED_VERIFICATION" }, { status: 410 });
  const claim = found.data.claims as unknown as { newsletter_id: string };
  const rpc = await supabase.rpc("claim_founding_position", { p_newsletter_id: claim.newsletter_id });
  if (rpc.error) return NextResponse.json({ error: rpc.error.message.includes("FOUNDING_100_FULL") ? "FOUNDING_100_FULL" : "CONFIRMATION_FAILED" }, { status: 409 });
  await supabase.from("ownership_verifications").update({ used_at: new Date().toISOString() }).eq("id", found.data.id);
  await supabase.from("claims").update({ status: "confirmed" }).eq("id", found.data.claim_id);
  await supabase.from("newsletters").update({ ownership_status: "confirmed", boardmark_status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", claim.newsletter_id);
  await supabase.from("public_profiles").upsert({ newsletter_id: claim.newsletter_id, slug: (await supabase.from("newsletters").select("slug").eq("id", claim.newsletter_id).single()).data?.slug, is_published: true }, { onConflict: "newsletter_id" });
  await supabase.from("activity_events").insert({ newsletter_id: claim.newsletter_id, event_type: "confirmed", approved: true });
  return NextResponse.json({ confirmed: true, foundingPosition: rpc.data });
}
