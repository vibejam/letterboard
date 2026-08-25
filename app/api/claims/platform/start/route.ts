import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createPlatformCode, hashVerificationValue, PLATFORM_SESSION_COOKIE } from "@/lib/platformVerification";
import { inferVerifiedPlatform } from "@/lib/platform";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = request.headers.get("cookie")?.match(new RegExp(`${PLATFORM_SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
  const supabase = getSupabaseAdmin();
  if (!session || !supabase) return NextResponse.json({ error: "PLATFORM_SESSION_INVALID" }, { status: 401 });

  const rawCode = createPlatformCode();
  const result = await supabase.rpc("start_platform_verification", {
    p_session_hash: hashVerificationValue(session),
    p_code_hash: hashVerificationValue(rawCode),
  });
  if (result.error || !result.data?.[0]) return NextResponse.json({ error: "PLATFORM_VERIFICATION_UNAVAILABLE" }, { status: 409 });
  const verification = result.data[0] as { method: string; source_platform: string | null; canonical_url: string; verification_state: string };
  const platform = inferVerifiedPlatform(verification.source_platform, verification.canonical_url);
  if (verification.method === "manual_review_required") {
    return NextResponse.json({ status: "manual_review_required", platform });
  }

  const host = new URL(verification.canonical_url).hostname.toLowerCase().replace(/^www\./, "");
  const response = NextResponse.json({
    status: "code_ready",
    method: verification.method,
    platform,
    code: rawCode,
    dnsRecord: verification.method === "dns_txt" ? `_letterboard.${host}` : null,
    expiresAt: result.data[0].expires_at,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
