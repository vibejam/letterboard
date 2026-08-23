import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export async function GET() {
  const configured = Boolean(getSupabaseAdmin());
  return NextResponse.json({ ok: true, configured, founding100Enabled: process.env.FOUNDING100_ENABLED !== "false", spotlightEnabled: false });
}
