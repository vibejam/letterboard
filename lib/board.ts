import { getSupabaseAdmin } from "./supabaseAdmin";
import { safeExternalUrl } from "./urls";
import { inferSharePlatformFromCanonicalUrl } from "./share";

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
type BoardRow = { id: string; slug: string; title: string; description?: string | null; logo_url?: string | null; logo_source?: string | null; canonical_url: string; source_platform?: string | null; founding_position: number | null; founding_tier?: string | null; newsletter_clicks?: number | null; ownership_status: string };

export type BoardPayload = {
  stats: { reserved: number; claimed: number; open: number; total: number };
  top: BoardRow[];
  rows: BoardRow[];
  activity: Array<{ id: number; event_type: string; created_at: string; newsletters?: { title?: string; slug?: string } | { title?: string; slug?: string }[] | null }>;
};

export async function getNewsletterClickCount(supabase: AdminClient, newsletterId: string) {
  const result = await supabase.from("newsletter_clicks").select("id", { count: "exact", head: true }).eq("newsletter_id", newsletterId);
  return result.error ? null : result.count ?? 0;
}

export async function getBoardPayload(): Promise<BoardPayload | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { stats: { reserved: 0, claimed: 0, open: 100, total: 100 }, top: [], rows: [], activity: [] };
  const board = await supabase.from("newsletters").select("id,slug,title,description,logo_url,logo_source,canonical_url,source_platform,founding_position,founding_tier,ownership_status").in("ownership_status", ["pending", "confirmed"]).not("founding_position", "is", null).order("founding_position", { ascending: true });
  if (board.error) return null;
  const confirmedIds = board.data.filter((row) => row.ownership_status === "confirmed").map((row) => row.id);
  const activity = confirmedIds.length
    ? await supabase.from("activity_events").select("id,event_type,created_at,newsletter_id").eq("approved", true).in("newsletter_id", confirmedIds).order("created_at", { ascending: false }).limit(8)
    : { data: [], error: null };
  if (activity.error) return null;
  const newsletterIds = board.data.map((row) => row.id);
  const clicks = newsletterIds.length ? await supabase.from("newsletter_clicks").select("newsletter_id").in("newsletter_id", newsletterIds) : { data: [], error: null };
  if (clicks.error) return null;
  const clickCounts = new Map<string, number>();
  for (const click of clicks.data ?? []) clickCounts.set(click.newsletter_id, (clickCounts.get(click.newsletter_id) ?? 0) + 1);
  const safeRows = board.data.map((row) => {
    const inferredPlatform = inferSharePlatformFromCanonicalUrl(row.canonical_url);
    return { ...row, source_platform: row.source_platform ?? (inferredPlatform === "unknown" ? null : inferredPlatform), logo_url: safeExternalUrl(row.logo_url), newsletter_clicks: clickCounts.get(row.id) ?? 0 };
  });
  const claimed = safeRows.filter((row) => row.ownership_status === "confirmed").length;
  const reserved = safeRows.filter((row) => row.ownership_status === "pending").length;
  const newsletterById = new Map(safeRows.map((row) => [row.id, row]));
  const publicActivity = (activity.data ?? []).map((event) => ({
    id: event.id,
    event_type: event.event_type,
    created_at: event.created_at,
    newsletters: newsletterById.get(event.newsletter_id) ? { title: newsletterById.get(event.newsletter_id)?.title, slug: newsletterById.get(event.newsletter_id)?.slug } : null,
  }));
  return { stats: { reserved, claimed, open: Math.max(0, 100 - reserved - claimed), total: 100 }, top: safeRows.slice(0, 3), rows: safeRows.slice(3), activity: publicActivity };
}
