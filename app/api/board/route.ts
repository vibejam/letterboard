import { NextResponse } from "next/server";
import { getBoardPayload } from "@/lib/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const board = await getBoardPayload();
  if (!board) return NextResponse.json({ error: "BOARD_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(board, { headers: { "Cache-Control": "no-store" } });
}
