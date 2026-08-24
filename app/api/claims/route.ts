import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { createOpaqueToken, maskEmail, normalizeCreatorEmail, sendOwnershipEmail } from "@/lib/ownership";
import { safeSlug } from "@/lib/urls";

export const runtime = "nodejs";

type ClaimBody = {
  newsletter?: { canonicalUrl: string; normalizedUrl: string; title: string; description?: string | null; logoUrl?: string | null; sourcePlatform?: string };
  submittedUrl?: string;
  creatorEmail?: unknown;
};

export async function POST(request: Request) {
  if (!rateLimit(`claim:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 5)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const body = await request.json().catch(() => null) as ClaimBody | null;
  const creatorEmail = normalizeCreatorEmail(body?.creatorEmail);
  if (!body?.newsletter?.normalizedUrl || !body.newsletter.title) return NextResponse.json({ error: "INVALID_CLAIM" }, { status: 400 });
  if (!creatorEmail) return NextResponse.json({ error: typeof body.creatorEmail === "string" && body.creatorEmail.trim() ? "INVALID_EMAIL" : "EMAIL_REQUIRED" }, { status: 400 });
  if (!process.env.RESEND_API_KEY || !process.env.OWNERSHIP_EMAIL_FROM) return NextResponse.json({ error: "RESEND_CONFIG_MISSING" }, { status: 503 });
  if (!process.env.NEXT_PUBLIC_APP_URL) return NextResponse.json({ error: "APP_URL_NOT_CONFIGURED" }, { status: 503 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  const requestId = randomUUID();
  const n = body.newsletter;
  try {
    const existing = await supabase.from("newsletters").select("id,slug,founding_position,ownership_status").eq("normalized_url", n.normalizedUrl).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      const pendingClaims = await supabase.from("claims").select("id,contact_email").eq("newsletter_id", existing.data.id).eq("status", "pending").limit(2);
      if (pendingClaims.error) throw pendingClaims.error;
      const pendingClaim = pendingClaims.data?.length === 1 ? pendingClaims.data[0] : null;
      return NextResponse.json({
        error: "DUPLICATE_NEWSLETTER",
        newsletter: existing.data,
        ...(pendingClaim ? {
          claim: {
            id: pendingClaim.id,
            status: "pending" as const,
            profileSlug: existing.data.slug,
            emailStatus: "failed" as const,
            maskedRecipient: typeof pendingClaim.contact_email === "string" ? maskEmail(pendingClaim.contact_email) : undefined,
          },
        } : {}),
      }, { status: 409 });
    }

    const inserted = await supabase.from("newsletters").insert({ canonical_url: n.canonicalUrl, normalized_url: n.normalizedUrl, slug: safeSlug(n.title, n.normalizedUrl), title: n.title, description: n.description, logo_url: n.logoUrl, source_platform: n.sourcePlatform, metadata_status: "ready", claimed_at: new Date().toISOString() }).select("id,slug,title,description,canonical_url,ownership_status").single();
    if (inserted.error) throw inserted.error;
    const claim = await supabase.from("claims").insert({ newsletter_id: inserted.data.id, submitted_url: body.submittedUrl ?? n.canonicalUrl, contact_email: creatorEmail }).select("id").single();
    if (claim.error) throw claim.error;
    const { rawToken, tokenHash } = createOpaqueToken();
    const verification = await supabase.from("ownership_verifications").insert({ claim_id: claim.data.id, token_hash: tokenHash, expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() });
    if (verification.error) throw verification.error;

    const email = await sendOwnershipEmail({ requestId, claimId: claim.data.id, recipient: creatorEmail, newsletterTitle: n.title, rawToken });
    const claimResponse = { id: claim.data.id, status: "pending" as const, profileSlug: inserted.data.slug, emailStatus: email.ok ? "sent" as const : "failed" as const, maskedRecipient: maskEmail(creatorEmail) };
    if (!email.ok) return NextResponse.json({ error: email.reason, claim: claimResponse }, { status: 502 });
    return NextResponse.json({ claim: claimResponse });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return NextResponse.json({ error: "DUPLICATE_NEWSLETTER" }, { status: 409 });
    console.error("claim creation failed", { requestId, outcome: "failed" });
    return NextResponse.json({ error: "CLAIM_FAILED" }, { status: 500 });
  }
}
