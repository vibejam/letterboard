import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";

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
  const existing = await supabase.from("ownership_verifications").select("claim_id,expires_at,used_at").eq("token_hash", hash).maybeSingle();
  if (existing.error || !existing.data) return confirmationRedirect(request, { error: "INVALID_VERIFICATION" });
  if (existing.data.used_at) {
    const claim = await supabase.from("claims").select("status").eq("id", existing.data.claim_id).maybeSingle();
    return confirmationRedirect(request, { error: claim.data?.status === "confirmed" ? "ALREADY_CONFIRMED" : "EXPIRED_VERIFICATION" });
  }
  if (new Date(existing.data.expires_at) < new Date()) return confirmationRedirect(request, { error: "EXPIRED_VERIFICATION" });

  const confirmed = await supabase.rpc("confirm_ownership", { p_token_hash: hash });
  if (confirmed.error || !confirmed.data?.[0]) {
    const message = confirmed.error?.message ?? "CONFIRMATION_FAILED";
    if (message.includes("FOUNDING_100_FULL")) return confirmationRedirect(request, { error: "FOUNDING_100_FULL" });
    if (message.includes("INVALID_VERIFICATION")) return confirmationRedirect(request, { error: "EXPIRED_VERIFICATION" });
    return confirmationRedirect(request, { error: "CONFIRMATION_FAILED" });
  }
  const result = confirmed.data[0];
  const profile = await supabase.from("newsletters").select("title").eq("slug", result.profile_slug).maybeSingle();
  return confirmationRedirect(request, {
    status: "confirmed",
    position: String(result.founding_position),
    tier: String(result.founding_tier).toLowerCase(),
    slug: result.profile_slug,
    ...(profile.data?.title ? { title: profile.data.title } : {}),
  });
}
