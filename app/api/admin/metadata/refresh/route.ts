import { NextResponse } from "next/server";
import { resolvePublicMetadata } from "@/lib/metadata";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { safeExternalUrl } from "@/lib/urls";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authorized(request: Request) {
  return Boolean(process.env.ADMIN_REVIEW_TOKEN && request.headers.get("authorization") === `Bearer ${process.env.ADMIN_REVIEW_TOKEN}`);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  const body = await request.json().catch(() => null) as { id?: unknown; slug?: unknown; persist?: unknown } | null;
  const id = typeof body?.id === "string" && UUID_PATTERN.test(body.id) ? body.id : null;
  const slug = typeof body?.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug) ? body.slug : null;
  if (!id && !slug) return NextResponse.json({ error: "INVALID_METADATA_REFRESH" }, { status: 400 });

  let query = supabase.from("newsletters").select("id,slug,canonical_url,ownership_status").eq("ownership_status", "confirmed");
  query = id ? query.eq("id", id) : query.eq("slug", slug as string);
  const current = await query.maybeSingle();
  if (current.error || !current.data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  let metadata;
  try {
    metadata = await resolvePublicMetadata(current.data.canonical_url);
  } catch {
    return NextResponse.json({ error: "METADATA_UNAVAILABLE" }, { status: 502 });
  }
  const safeLogoUrl = safeExternalUrl(metadata.logoUrl);
  const update = {
    logo_url: safeLogoUrl,
    logo_source: safeLogoUrl ? metadata.logoSource : "fallback",
    logo_width: safeLogoUrl ? metadata.logoWidth : null,
    logo_height: safeLogoUrl ? metadata.logoHeight : null,
    source_platform: metadata.sourcePlatform,
    metadata_status: metadata.metadataStatus,
  };
  if (body?.persist !== true) return NextResponse.json({ ok: true, preview: true, metadata: update });

  const saved = await supabase.from("newsletters").update(update).eq("id", current.data.id).eq("ownership_status", "confirmed");
  if (saved.error) return NextResponse.json({ error: "METADATA_REFRESH_FAILED" }, { status: 503 });
  return NextResponse.json({ ok: true, preview: false, metadata: update });
}
