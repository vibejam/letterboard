import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { inferVerifiedPlatform } from "@/lib/platform";
import { maskEmail } from "@/lib/ownership";
import { safeExternalUrl } from "@/lib/urls";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type NewsletterReviewRow = { id: string; slug: string; title: string; canonical_url: string; source_platform: string | null; ownership_status: string; founding_position: number | null; founding_tier: string | null };
type ClaimReviewRow = { id: string; status: string; verification_state: string; email_verified_at: string | null; platform_verified_at: string | null; created_at: string; updated_at: string; contact_email: string | null; newsletter_id: string; newsletters: NewsletterReviewRow | NewsletterReviewRow[] | null };
type ShareRow = { newsletter_id: string; channel: string; share_url: string | null; created_at: string };
type ActivityRow = { newsletter_id: string; event_type: string; approved: boolean; created_at: string };
type AuditRow = { action: string; target_id: string | null; metadata: unknown; created_at: string };

function authorized(request: Request) {
  return Boolean(process.env.ADMIN_REVIEW_TOKEN && request.headers.get("authorization") === `Bearer ${process.env.ADMIN_REVIEW_TOKEN}`);
}

function errorCode(error: unknown) {
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  return /CREATOR_BANNED|CLAIM_NOT_ELIGIBLE|FOUNDING_100_FULL|INVALID_REVIEW/.exec(message)?.[0] ?? "REVIEW_FAILED";
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  const result = await supabase.from("claims").select("id,status,verification_state,email_verified_at,platform_verified_at,created_at,updated_at,contact_email,newsletter_id,newsletters(id,slug,title,canonical_url,source_platform,ownership_status,founding_position,founding_tier)").eq("status", "pending").order("created_at", { ascending: true });
  if (result.error) return NextResponse.json({ error: "REVIEW_UNAVAILABLE" }, { status: 503 });
  const claims = (result.data ?? []) as ClaimReviewRow[];
  const claimIds = claims.map((claim) => claim.id);
  const newsletterIds = claims.map((claim) => claim.newsletter_id);
  const [shares, activity, audits] = await Promise.all([
    newsletterIds.length ? supabase.from("share_events").select("newsletter_id,channel,share_url,created_at").in("newsletter_id", newsletterIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    newsletterIds.length ? supabase.from("activity_events").select("newsletter_id,event_type,approved,created_at").in("newsletter_id", newsletterIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    claimIds.length ? supabase.from("admin_audit_log").select("action,target_id,metadata,created_at").in("target_id", claimIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (shares.error || activity.error || audits.error) return NextResponse.json({ error: "REVIEW_UNAVAILABLE" }, { status: 503 });
  const shareRows = (shares.data ?? []) as ShareRow[];
  const activityRows = (activity.data ?? []) as ActivityRow[];
  const auditRows = (audits.data ?? []) as AuditRow[];
  const reviews = claims.map((claim) => {
    const newsletter = Array.isArray(claim.newsletters) ? claim.newsletters[0] : claim.newsletters;
    const share = shareRows.find((row) => row.newsletter_id === claim.newsletter_id);
    const audit = auditRows.find((row) => row.target_id === claim.id && ["claim_review_approved", "claim_review_rejected", "claim_approve", "claim_reject"].includes(row.action));
    const auditReason = audit?.metadata && typeof audit.metadata === "object" && "reason" in audit.metadata && typeof audit.metadata.reason === "string" ? audit.metadata.reason : null;
    return {
      claimId: claim.id,
      claimStatus: claim.status,
      verificationState: claim.verification_state,
      createdAt: claim.created_at,
      updatedAt: claim.updated_at,
      emailVerifiedAt: claim.email_verified_at,
      platformVerifiedAt: claim.platform_verified_at,
      publication: {
        id: newsletter?.id ?? claim.newsletter_id,
        slug: newsletter?.slug ?? null,
        title: newsletter?.title ?? null,
        canonicalUrl: safeExternalUrl(newsletter?.canonical_url) ?? null,
        platform: inferVerifiedPlatform(newsletter?.source_platform, newsletter?.canonical_url),
        ownershipStatus: newsletter?.ownership_status ?? null,
        foundingPosition: newsletter?.founding_position ?? null,
        foundingTier: newsletter?.founding_tier ?? null,
      },
      creatorEmail: typeof claim.contact_email === "string" ? maskEmail(claim.contact_email) : null,
      creatorShared: Boolean(share),
      shareChannel: share?.channel ?? null,
      shareUrl: safeExternalUrl(share?.share_url) ?? null,
      activity: activityRows.filter((row) => row.newsletter_id === claim.newsletter_id).map((row) => ({ eventType: row.event_type, approved: row.approved, createdAt: row.created_at })),
      reviewerDecision: audit?.action ?? null,
      reviewerReason: auditReason,
    };
  });
  return NextResponse.json({ reviews }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  const body = await request.json().catch(() => null) as { claimId?: unknown; decision?: unknown; reason?: unknown } | null;
  const claimId = typeof body?.claimId === "string" ? body.claimId.trim() : "";
  const decision = typeof body?.decision === "string" ? body.decision.trim().toLowerCase() : "";
  const reason = typeof body?.reason === "string" ? body.reason.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) : "";
  if (!UUID.test(claimId) || !["approve", "reject"].includes(decision) || reason.length < 1) return NextResponse.json({ error: "INVALID_REVIEW" }, { status: 400 });
  const result = await supabase.rpc("review_claim_by_admin", { p_claim_id: claimId, p_decision: decision, p_reason: reason });
  if (result.error || !result.data?.[0]) {
    const code = errorCode(result.error);
    return NextResponse.json({ error: code }, { status: code === "REVIEW_FAILED" ? 500 : 409 });
  }
  const review = result.data[0] as { claim_id: string; newsletter_id: string; decision: string; claim_status: string; verification_state: string; founding_position: number | null; founding_tier: string | null; profile_slug: string };
  return NextResponse.json({ ok: true, review: { claimId: review.claim_id, newsletterId: review.newsletter_id, decision: review.decision, claimStatus: review.claim_status, verificationState: review.verification_state, foundingPosition: review.founding_position, foundingTier: review.founding_tier, profileSlug: review.profile_slug } }, { headers: { "Cache-Control": "no-store" } });
}
