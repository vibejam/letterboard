import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyDnsOwnershipCode, verifyPublicOwnershipCode } from "@/lib/metadata";
import { hashVerificationValue, PLATFORM_SESSION_COOKIE, safeVerificationCode } from "@/lib/platformVerification";
import { inferVerifiedPlatform } from "@/lib/platform";

export const runtime = "nodejs";

function sessionFrom(request: Request) {
  return request.headers.get("cookie")?.match(new RegExp(`${PLATFORM_SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
}

export async function POST(request: Request) {
  const session = sessionFrom(request);
  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = safeVerificationCode(body?.code);
  const supabase = getSupabaseAdmin();
  if (!session || !code || !supabase) return NextResponse.json({ error: "INVALID_PLATFORM_VERIFICATION" }, { status: 400 });

  const sessionRow = await supabase.from("claim_verification_sessions").select("claim_id,expires_at,used_at").eq("session_hash", hashVerificationValue(session)).maybeSingle();
  if (sessionRow.error || !sessionRow.data || sessionRow.data.used_at || new Date(sessionRow.data.expires_at) <= new Date()) return NextResponse.json({ error: "PLATFORM_SESSION_INVALID" }, { status: 401 });
  const claimRow = await supabase.from("claims").select("id,verification_state,newsletters(id,slug,title,canonical_url,source_platform)").eq("id", sessionRow.data.claim_id).maybeSingle();
  if (claimRow.error || !claimRow.data || claimRow.data.verification_state !== "email_verified") return NextResponse.json({ error: "PLATFORM_VERIFICATION_REQUIRED" }, { status: 409 });
  const newsletter = claimRow.data.newsletters as unknown as { id: string; slug: string; title: string; canonical_url: string; source_platform: string | null } | null;
  if (!newsletter) return NextResponse.json({ error: "PLATFORM_VERIFICATION_UNAVAILABLE" }, { status: 409 });

  const platform = inferVerifiedPlatform(newsletter.source_platform, newsletter.canonical_url);
  const verified = ["substack", "medium", "x", "linkedin"].includes(platform)
    ? await verifyPublicOwnershipCode(newsletter.canonical_url, code)
    : platform === "independent"
      ? await verifyDnsOwnershipCode(newsletter.canonical_url, code)
      : false;
  if (!verified) return NextResponse.json({ error: "PLATFORM_CODE_NOT_FOUND" }, { status: 422 });

  const result = await supabase.rpc("verify_platform_ownership", {
    p_session_hash: hashVerificationValue(session),
    p_code_hash: hashVerificationValue(code),
  });
  if (result.error || !result.data?.[0]) return NextResponse.json({ error: "PLATFORM_VERIFICATION_FAILED" }, { status: 409 });
  const response = NextResponse.json({ status: "confirmed", confirmation: result.data[0] }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(PLATFORM_SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
  return response;
}
