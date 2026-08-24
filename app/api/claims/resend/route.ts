import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { createOpaqueToken, maskEmail, normalizeCreatorEmail, sendOwnershipEmail } from "@/lib/ownership";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { claimId?: unknown; creatorEmail?: unknown } | null;
  const claimId = typeof body?.claimId === "string" ? body.claimId : "";
  const creatorEmail = normalizeCreatorEmail(body?.creatorEmail);
  if (!claimId || !creatorEmail) return NextResponse.json({ error: "CLAIM_NOT_RESENDABLE" }, { status: 400 });
  if (!rateLimit(`resend-confirmation:${request.headers.get("x-forwarded-for") ?? "unknown"}:${claimId}`, 3)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });

  const result = await supabase.from("claims").select("id,status,contact_email,newsletters(title)").eq("id", claimId).maybeSingle();
  if (result.error || !result.data) return NextResponse.json({ error: "CLAIM_NOT_RESENDABLE" }, { status: 400 });
  if (result.data.status !== "pending" || result.data.contact_email !== creatorEmail) return NextResponse.json({ error: "CLAIM_NOT_RESENDABLE" }, { status: 400 });
  const newsletter = result.data.newsletters as unknown as { title: string } | null;
  if (!newsletter?.title) return NextResponse.json({ error: "CLAIM_NOT_RESENDABLE" }, { status: 400 });

  const revoked = await supabase.from("ownership_verifications").update({ used_at: new Date().toISOString() }).eq("claim_id", claimId).is("used_at", null);
  if (revoked.error) return NextResponse.json({ error: "RESEND_FAILED" }, { status: 502 });
  const { rawToken, tokenHash } = createOpaqueToken();
  const verification = await supabase.from("ownership_verifications").insert({ claim_id: claimId, token_hash: tokenHash, expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() });
  if (verification.error) return NextResponse.json({ error: "RESEND_FAILED" }, { status: 502 });

  const email = await sendOwnershipEmail({ requestId: randomUUID(), claimId, recipient: creatorEmail, newsletterTitle: newsletter.title, rawToken });
  if (!email.ok) return NextResponse.json({ error: email.reason, claim: { id: claimId, status: "pending", emailStatus: "failed", maskedRecipient: maskEmail(creatorEmail) } }, { status: 502 });
  return NextResponse.json({ claim: { id: claimId, status: "pending", emailStatus: "sent", maskedRecipient: maskEmail(creatorEmail) } });
}
