import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { safeExternalUrl } from "@/lib/urls";
import { hashVerificationValue, PLATFORM_SESSION_COOKIE } from "@/lib/platformVerification";

export const runtime = "nodejs";

function confirmationRedirect(request: Request, values: Record<string, string>) {
  const url = new URL("/confirmation", request.url);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET(request: Request) {
  if (!rateLimit(`confirm:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 12)) return confirmationRedirect(request, { error: "RATE_LIMITED" });
  const supabase = getSupabaseAdmin();
  const token = new URL(request.url).searchParams.get("token");
  if (!supabase) return confirmationRedirect(request, { error: "CONFIRMATION_FAILED" });
  if (!token || token.length > 256) return confirmationRedirect(request, { error: token ? "INVALID_VERIFICATION" : "MISSING_TOKEN" });

  const hash = createHash("sha256").update(token).digest("hex");
  const existing = await supabase.from("ownership_verifications").select("claim_id,expires_at,used_at,method").eq("token_hash", hash).maybeSingle();
  if (existing.error || !existing.data) return confirmationRedirect(request, { error: "INVALID_VERIFICATION" });
  if (existing.data.used_at) {
    const claim = await supabase.from("claims").select("status,verification_state").eq("id", existing.data.claim_id).maybeSingle();
    if (claim.data?.status === "pending" && claim.data.verification_state === "email_verified" && existing.data.method === "email") {
      const sessionToken = randomBytes(32).toString("hex");
      const resumed = await supabase.rpc("resume_email_verification_session", { p_token_hash: hash, p_session_hash: hashVerificationValue(sessionToken) });
      if (resumed.error || !resumed.data?.[0]) return confirmationRedirect(request, { error: "CONFIRMATION_FAILED" });
      const response = confirmationRedirect(request, { status: "email_verified", slug: resumed.data[0].profile_slug, title: resumed.data[0].newsletter_title, sourcePlatform: resumed.data[0].source_platform ?? "independent", newsletterUrl: safeExternalUrl(resumed.data[0].canonical_url) ?? "" });
      response.cookies.set(PLATFORM_SESSION_COOKIE, sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 1800, path: "/" });
      return response;
    }
    return confirmationRedirect(request, { error: claim.data?.status === "confirmed" ? "ALREADY_CONFIRMED" : "EXPIRED_VERIFICATION" });
  }
  if (new Date(existing.data.expires_at) < new Date()) return confirmationRedirect(request, { error: "EXPIRED_VERIFICATION" });

  const sessionToken = randomBytes(32).toString("hex");
  const verified = await supabase.rpc("confirm_email_ownership", { p_token_hash: hash, p_session_hash: hashVerificationValue(sessionToken) });
  if (verified.error || !verified.data?.[0]) {
    const message = verified.error?.message ?? "CONFIRMATION_FAILED";
    if (message.includes("FOUNDING_100_FULL")) return confirmationRedirect(request, { error: "FOUNDING_100_FULL" });
    if (message.includes("CREATOR_BANNED")) return confirmationRedirect(request, { error: "CREATOR_BANNED" });
    if (message.includes("INVALID_VERIFICATION")) return confirmationRedirect(request, { error: "EXPIRED_VERIFICATION" });
    return confirmationRedirect(request, { error: "CONFIRMATION_FAILED" });
  }
  const result = verified.data[0];
  const response = confirmationRedirect(request, { status: "email_verified", slug: result.profile_slug, title: result.newsletter_title, sourcePlatform: result.source_platform ?? "independent", newsletterUrl: safeExternalUrl(result.canonical_url) ?? "" });
  response.cookies.set(PLATFORM_SESSION_COOKIE, sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 1800, path: "/" });
  return response;
}
