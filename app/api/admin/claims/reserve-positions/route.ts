import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function authorized(request: Request) {
  return Boolean(process.env.ADMIN_REVIEW_TOKEN && request.headers.get("authorization") === `Bearer ${process.env.ADMIN_REVIEW_TOKEN}`);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });

  const result = await supabase.rpc("reserve_pending_founding_positions");
  if (result.error) return NextResponse.json({ error: "FOUNDING_POSITION_REPAIR_FAILED" }, { status: 503 });

  const reservations = (result.data ?? []) as Array<{ claim_id: string; newsletter_id: string; founding_position: number; founding_tier: string }>;
  if (reservations.length) {
    const audit = await supabase.from("admin_audit_log").insert(reservations.map((reservation) => ({
      action: "founding_position_repair",
      target_id: reservation.claim_id,
      metadata: { newsletter_id: reservation.newsletter_id, founding_position: reservation.founding_position, founding_tier: reservation.founding_tier },
    })));
    if (audit.error) return NextResponse.json({ error: "FOUNDING_POSITION_REPAIR_AUDIT_FAILED" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, repaired: reservations.length, reservations }, { headers: { "Cache-Control": "no-store" } });
}
