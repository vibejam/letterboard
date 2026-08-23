import { NextResponse } from "next/server";
import { resolvePublicMetadata } from "@/lib/metadata";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!rateLimit(`resolve:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 8)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  try {
    const body = await request.json() as { url?: string };
    if (!body.url || body.url.length > 2048) return NextResponse.json({ error: "INVALID_URL" }, { status: 400 });
    return NextResponse.json({ newsletter: await resolvePublicMetadata(body.url) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "METADATA_UNAVAILABLE";
    return NextResponse.json({ error: code }, { status: code === "UNSUPPORTED_URL" ? 422 : 400 });
  }
}
