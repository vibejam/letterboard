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
  const result = await supabase.rpc("retire_vesper_test_listing");
  if (result.error || !result.data?.[0]) return NextResponse.json({ error: "VESPER_RETIREMENT_FAILED" }, { status: 409 });
  return NextResponse.json({ ok: true, listing: result.data[0] }, { headers: { "Cache-Control": "no-store" } });
}
