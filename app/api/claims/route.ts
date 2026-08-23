import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { safeSlug } from "@/lib/urls";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!rateLimit(`claim:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 5)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  try {
    const body = await request.json() as { newsletter?: { canonicalUrl: string; normalizedUrl: string; title: string; description?: string | null; logoUrl?: string | null; sourcePlatform?: string }; submittedUrl?: string; contactEmail?: string };
    if (!body.newsletter?.normalizedUrl || !body.newsletter.title) return NextResponse.json({ error: "INVALID_CLAIM" }, { status: 400 });
    const n = body.newsletter;
    const existing = await supabase.from("newsletters").select("id,slug,founding_position,ownership_status").eq("normalized_url", n.normalizedUrl).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return NextResponse.json({ error: "DUPLICATE_NEWSLETTER", newsletter: existing.data }, { status: 409 });
    const inserted = await supabase.from("newsletters").insert({ canonical_url: n.canonicalUrl, normalized_url: n.normalizedUrl, slug: safeSlug(n.title, n.normalizedUrl), title: n.title, description: n.description, logo_url: n.logoUrl, source_platform: n.sourcePlatform, metadata_status: "ready", claimed_at: new Date().toISOString() }).select("id,slug,title,description,canonical_url,ownership_status").single();
    if (inserted.error) throw inserted.error;
    const claim = await supabase.from("claims").insert({ newsletter_id: inserted.data.id, submitted_url: body.submittedUrl ?? n.canonicalUrl, contact_email: body.contactEmail ?? null }).select("id").single();
    if (claim.error) throw claim.error;
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const verification = await supabase.from("ownership_verifications").insert({ claim_id: claim.data.id, token_hash: tokenHash, expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() });
    if (verification.error) throw verification.error;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    let emailSent = false;
    if (body.contactEmail && process.env.RESEND_API_KEY) {
      const email = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: process.env.OWNERSHIP_EMAIL_FROM ?? "Letterboard <onboarding@letterboard.co>", to: [body.contactEmail], subject: "Confirm your Letterboard Founding 100 place", html: `<p>Confirm ownership of ${n.title} on Letterboard.</p><p><a href="${appUrl}/api/claims/confirm?token=${rawToken}">Confirm ownership</a></p><p>This link expires in 48 hours and can only be used once.</p>` }) });
      emailSent = email.ok;
    }
    return NextResponse.json({ claim: { id: claim.data.id, status: "pending", profileSlug: inserted.data.slug, ...(process.env.NODE_ENV !== "production" ? { confirmationUrl: `/api/claims/confirm?token=${rawToken}` } : {}) }, emailSent });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return NextResponse.json({ error: "DUPLICATE_NEWSLETTER" }, { status: 409 });
    console.error("claim creation failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "CLAIM_FAILED" }, { status: 500 });
  }
}
