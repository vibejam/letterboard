import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
function authorized(request: Request) { return Boolean(process.env.ADMIN_REVIEW_TOKEN && request.headers.get("authorization") === `Bearer ${process.env.ADMIN_REVIEW_TOKEN}`); }
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const supabase = getSupabaseAdmin(); if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  const result = await supabase.from("claims").select("id,status,created_at,newsletters(id,title,canonical_url,ownership_status)").eq("status", "pending").order("created_at", { ascending: true });
  return result.error ? NextResponse.json({ error: "REVIEW_UNAVAILABLE" }, { status: 503 }) : NextResponse.json({ reviews: result.data });
}
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const supabase = getSupabaseAdmin(); if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  const body = await request.json() as { claimId?: string; decision?: "approve" | "reject" };
  if (!body.claimId || !body.decision) return NextResponse.json({ error: "INVALID_REVIEW" }, { status: 400 });
  if (body.decision === "approve") {
    const confirmed = await supabase.rpc("confirm_claim_by_admin", { p_claim_id: body.claimId });
    if (confirmed.error || !confirmed.data?.[0]) return NextResponse.json({ error: "REVIEW_FAILED" }, { status: 409 });
    await supabase.from("admin_audit_log").insert({ action: "claim_approve", target_id: body.claimId, metadata: { foundingPosition: confirmed.data[0].founding_position, foundingTier: confirmed.data[0].founding_tier } });
    return NextResponse.json({ ok: true, foundingPosition: confirmed.data[0].founding_position, foundingTier: confirmed.data[0].founding_tier });
  }
  const claim = await supabase.from("claims").update({ status: "rejected" }).eq("id", body.claimId).select("newsletter_id").single();
  if (claim.error) return NextResponse.json({ error: "REVIEW_FAILED" }, { status: 500 });
  await supabase.from("newsletters").update({ ownership_status: "rejected", boardmark_status: "pending", confirmed_at: null }).eq("id", claim.data.newsletter_id);
  if (body.decision === "reject") {
    await supabase.from("ownership_verifications").update({ used_at: new Date().toISOString() }).eq("claim_id", body.claimId).is("used_at", null);
    await supabase.from("public_profiles").update({ is_published: false }).eq("newsletter_id", claim.data.newsletter_id);
  }
  await supabase.from("admin_audit_log").insert({ action: `claim_${body.decision}`, target_id: claim.data.newsletter_id, metadata: { claimId: body.claimId } });
  return NextResponse.json({ ok: true });
}
