import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { createOpaqueToken, maskEmail, normalizeCreatorEmail, sendOwnershipEmail } from "@/lib/ownership";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authorized(request: Request) {
  return Boolean(process.env.ADMIN_REVIEW_TOKEN && request.headers.get("authorization") === `Bearer ${process.env.ADMIN_REVIEW_TOKEN}`);
}

function recipientDomain(email: string) {
  return email.split("@")[1] ?? "unknown";
}

function senderDomain() {
  const from = process.env.OWNERSHIP_EMAIL_FROM;
  const domain = from?.match(/<\s*[^@<>\s]+@([^<>\s]+)\s*>/)?.[1] ?? from?.match(/[^@\s]+@([^\s>]+)/)?.[1];
  return domain?.toLowerCase() ?? "unknown";
}

async function auditRepair(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, requestId: string, claimId: string, metadata: Record<string, unknown>) {
  const audit = await supabase.from("admin_audit_log").insert({ action: "claim_verification_repair", target_id: claimId || null, metadata: { requestId, ...metadata } });
  return audit.error;
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const body = await request.json().catch(() => null) as { claimId?: unknown; creatorEmail?: unknown } | null;
  const claimId = typeof body?.claimId === "string" && UUID_PATTERN.test(body.claimId) ? body.claimId : "";
  const creatorEmail = normalizeCreatorEmail(body?.creatorEmail);
  if (!claimId || !creatorEmail) return NextResponse.json({ error: "CLAIM_REPAIR_INPUT_INVALID" }, { status: 400 });
  if (!rateLimit(`admin-claim-repair:${claimId}`, 2)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });

  const result = await supabase.from("claims").select("id,newsletter_id,status,contact_email,newsletters(id,title,slug,canonical_url,ownership_status,boardmark_status,founding_position)").eq("id", claimId).maybeSingle();
  if (result.error || !result.data) {
    await auditRepair(supabase, requestId, claimId, { outcome: "claim_not_found", providerCalled: false });
    return NextResponse.json({ error: "CLAIM_NOT_RESENDABLE" }, { status: 409 });
  }

  const claim = result.data;
  const newsletter = claim.newsletters as unknown as { id: string; title: string; slug: string; canonical_url: string; ownership_status: string; boardmark_status: string; founding_position: number | null } | null;
  const baseAudit = { newsletterId: claim.newsletter_id, foundingPosition: newsletter?.founding_position ?? null, senderDomain: senderDomain(), recipientDomain: creatorEmail ? recipientDomain(creatorEmail) : "unknown", providerCalled: false };
  if (claim.status !== "pending" || !newsletter || newsletter.id !== claim.newsletter_id || newsletter.ownership_status !== "pending" || newsletter.boardmark_status !== "pending") {
    await auditRepair(supabase, requestId, claimId, { ...baseAudit, outcome: "claim_not_resendable" });
    return NextResponse.json({ error: "CLAIM_NOT_RESENDABLE" }, { status: 409 });
  }
  let storedContactEmail = claim.contact_email;
  if (!storedContactEmail) {
    const backfilled = await supabase.from("claims").update({ contact_email: creatorEmail }).eq("id", claimId).eq("status", "pending").is("contact_email", null).select("id,contact_email").maybeSingle();
    if (backfilled.error) {
      await auditRepair(supabase, requestId, claimId, { ...baseAudit, outcome: "claim_email_backfill_failed" });
      return NextResponse.json({ error: "CLAIM_REPAIR_FAILED" }, { status: 502 });
    }
    if (!backfilled.data?.contact_email) {
      await auditRepair(supabase, requestId, claimId, { ...baseAudit, outcome: "claim_email_backfill_conflict" });
      return NextResponse.json({ error: "CLAIM_EMAIL_MISMATCH" }, { status: 409 });
    }
    storedContactEmail = backfilled.data.contact_email;
  }
  if (normalizeCreatorEmail(storedContactEmail) !== creatorEmail) {
    await auditRepair(supabase, requestId, claimId, { ...baseAudit, outcome: "claim_email_mismatch" });
    return NextResponse.json({ error: "CLAIM_EMAIL_MISMATCH" }, { status: 403 });
  }

  const revoked = await supabase.from("ownership_verifications").update({ used_at: new Date().toISOString() }).eq("claim_id", claimId).is("used_at", null);
  if (revoked.error) {
    await auditRepair(supabase, requestId, claimId, { ...baseAudit, outcome: "token_revoke_failed" });
    return NextResponse.json({ error: "CLAIM_REPAIR_FAILED" }, { status: 502 });
  }
  const { rawToken, tokenHash } = createOpaqueToken();
  const verification = await supabase.from("ownership_verifications").insert({ claim_id: claimId, token_hash: tokenHash, expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), method: "admin_repair" });
  if (verification.error) {
    await auditRepair(supabase, requestId, claimId, { ...baseAudit, outcome: "token_create_failed" });
    return NextResponse.json({ error: "CLAIM_REPAIR_FAILED" }, { status: 502 });
  }

  const email = await sendOwnershipEmail({ requestId, claimId, recipient: creatorEmail, newsletterTitle: newsletter.title, rawToken });
  const emailMetadata = { ...baseAudit, providerCalled: true, outcome: email.ok ? "accepted" : "rejected", ...(email.ok ? { messageId: email.messageId } : { errorCode: email.errorCode ?? email.reason }) };
  const auditError = await auditRepair(supabase, requestId, claimId, emailMetadata);
  if (auditError) return NextResponse.json({ error: "CLAIM_REPAIR_AUDIT_FAILED" }, { status: 503 });
  if (!email.ok) return NextResponse.json({ error: email.reason, claim: { id: claimId, status: "pending", emailStatus: "failed", maskedRecipient: maskEmail(creatorEmail) } }, { status: 502 });
  return NextResponse.json({ ok: true, claimId, messageId: email.messageId, foundingPosition: newsletter.founding_position, maskedRecipient: maskEmail(creatorEmail) });
}
