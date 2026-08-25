import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { createOpaqueToken, creatorIdentityHash, maskEmail, normalizeCreatorEmail, sendOwnershipEmail } from "@/lib/ownership";
import { resolvePublicMetadata } from "@/lib/metadata";
import { normalizeNewsletterUrl, safeSlug } from "@/lib/urls";

export const runtime = "nodejs";

type ClaimBody = {
  newsletter?: { canonicalUrl?: string; title?: string };
  submittedUrl?: string;
  creatorEmail?: unknown;
};

function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return /CREATOR_ALREADY_CLAIMED|PUBLICATION_ALREADY_CLAIMED|CREATOR_BANNED|CLAIM_NOT_ELIGIBLE/.exec(message)?.[0] ?? ("code" in error && error.code === "23505" ? (message.includes("claims_one_active_creator_idx") ? "CREATOR_ALREADY_CLAIMED" : "PUBLICATION_ALREADY_CLAIMED") : "");
}

function metadataErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message === "UNSUPPORTED_URL" ? "UNSUPPORTED_URL" : "METADATA_UNAVAILABLE";
}

export async function POST(request: Request) {
  if (!rateLimit(`claim:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 5)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const body = await request.json().catch(() => null) as ClaimBody | null;
  const creatorEmail = normalizeCreatorEmail(body?.creatorEmail);
  const identityHash = creatorIdentityHash(body?.creatorEmail);
  const submittedUrl = typeof body?.submittedUrl === "string" && body.submittedUrl.trim() ? body.submittedUrl.trim() : body?.newsletter?.canonicalUrl?.trim();
  if (!submittedUrl || submittedUrl.length > 2048 || !creatorEmail || !identityHash) {
    if (!submittedUrl || submittedUrl.length > 2048) return NextResponse.json({ error: "INVALID_CLAIM" }, { status: 400 });
    return NextResponse.json({ error: typeof body?.creatorEmail === "string" && body.creatorEmail.trim() ? "INVALID_EMAIL" : "EMAIL_REQUIRED" }, { status: 400 });
  }
  if (!process.env.RESEND_API_KEY || !process.env.OWNERSHIP_EMAIL_FROM) return NextResponse.json({ error: "RESEND_CONFIG_MISSING" }, { status: 503 });
  if (!process.env.NEXT_PUBLIC_APP_URL) return NextResponse.json({ error: "APP_URL_NOT_CONFIGURED" }, { status: 503 });

  let normalizedInput: ReturnType<typeof normalizeNewsletterUrl>;
  try {
    normalizedInput = normalizeNewsletterUrl(submittedUrl);
  } catch {
    return NextResponse.json({ error: "UNSUPPORTED_URL" }, { status: 422 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  const requestId = randomUUID();
  try {
    const existing = await supabase.from("newsletters").select("id,slug,canonical_url,founding_position,ownership_status").eq("normalized_url", normalizedInput.normalizedUrl).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      const activeClaims = await supabase.from("claims").select("id,status").eq("newsletter_id", existing.data.id).in("status", ["pending", "confirmed"]).limit(2);
      if (activeClaims.error) throw activeClaims.error;
      if (activeClaims.data?.length) {
        return NextResponse.json({ error: "PUBLICATION_ALREADY_CLAIMED", newsletter: existing.data }, { status: 409 });
      }
      if (existing.data.ownership_status === "confirmed" || !["pending", "rejected"].includes(existing.data.ownership_status)) {
        return NextResponse.json({ error: "CLAIM_NOT_ELIGIBLE" }, { status: 409 });
      }
      if (existing.data.canonical_url !== normalizedInput.canonicalUrl) {
        return NextResponse.json({ error: "CLAIM_NOT_ELIGIBLE" }, { status: 409 });
      }
    }

    let n: Awaited<ReturnType<typeof resolvePublicMetadata>>;
    try {
      n = await resolvePublicMetadata(submittedUrl);
    } catch (error) {
      const code = metadataErrorCode(error);
      return NextResponse.json({ error: code }, { status: code === "UNSUPPORTED_URL" ? 422 : 400 });
    }
    if (existing.data && n.normalizedUrl !== normalizedInput.normalizedUrl) return NextResponse.json({ error: "CLAIM_NOT_ELIGIBLE" }, { status: 409 });

    const created = await supabase.rpc("create_pending_claim", {
      p_canonical_url: n.canonicalUrl,
      p_normalized_url: n.normalizedUrl,
      p_slug: safeSlug(n.title, n.normalizedUrl),
      p_title: n.title,
      p_description: n.description ?? null,
      p_logo_url: n.logoUrl ?? null,
      p_logo_source: n.logoSource ?? "fallback",
      p_logo_width: n.logoWidth ?? null,
      p_logo_height: n.logoHeight ?? null,
      p_source_platform: n.sourcePlatform ?? "independent",
      p_submitted_url: submittedUrl,
      p_contact_email: creatorEmail,
      p_identity_hash: identityHash,
    });
    if (created.error || !created.data?.[0]) throw created.error ?? new Error("CLAIM_NOT_ELIGIBLE");
    const createdClaim = created.data[0] as { claim_id: string; profile_slug: string; newsletter_title: string };
    const { rawToken, tokenHash } = createOpaqueToken();
    const verification = await supabase.from("ownership_verifications").insert({ claim_id: createdClaim.claim_id, token_hash: tokenHash, expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() });
    if (verification.error) throw verification.error;

    const email = await sendOwnershipEmail({ requestId, claimId: createdClaim.claim_id, recipient: creatorEmail, newsletterTitle: n.title, rawToken });
    const claimResponse = { id: createdClaim.claim_id, status: "pending" as const, profileSlug: createdClaim.profile_slug, emailStatus: email.ok ? "sent" as const : "failed" as const, maskedRecipient: maskEmail(creatorEmail) };
    if (!email.ok) return NextResponse.json({ error: email.reason, claim: claimResponse }, { status: 502 });
    return NextResponse.json({ claim: claimResponse });
  } catch (error) {
    const code = databaseErrorCode(error);
    if (code) return NextResponse.json({ error: code }, { status: 409 });
    console.error("claim creation failed", { requestId, outcome: "failed" });
    return NextResponse.json({ error: "CLAIM_FAILED" }, { status: 500 });
  }
}
