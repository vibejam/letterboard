import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { creatorIdentityHash, normalizeCreatorEmail } from "@/lib/ownership";

export const runtime = "nodejs";

function adminToken(request: Request) {
  const token = process.env.ADMIN_REVIEW_TOKEN;
  return token && request.headers.get("authorization") === `Bearer ${token}` ? token : null;
}

export async function POST(request: Request) {
  const token = adminToken(request);
  if (!token) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await request.json().catch(() => null) as { creatorEmail?: unknown; reason?: unknown; claimId?: unknown } | null;
  const email = normalizeCreatorEmail(body?.creatorEmail);
  const identityHash = creatorIdentityHash(body?.creatorEmail);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const claimId = typeof body?.claimId === "string" ? body.claimId : null;
  if (!email || !identityHash || !reason || reason.length > 500) return NextResponse.json({ error: "INVALID_BAN_INPUT" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  const actorId = `admin:${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
  const result = await supabase.rpc("ban_creator", { p_identity_hash: identityHash, p_reason: reason, p_actor_id: actorId, p_claim_id: claimId });
  if (result.error || !result.data?.[0]) return NextResponse.json({ error: "BAN_FAILED" }, { status: 409 });
  return NextResponse.json({ ok: true, banned: true, auditRecorded: true, requestId: randomUUID() });
}
