import { getSupabaseAdmin } from "./supabaseAdmin";
import { safeExternalUrl } from "./urls";

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
type BoardRow = { id: string; slug: string; title: string; description?: string | null; logo_url?: string | null; logo_source?: string | null; canonical_url: string; source_platform?: string | null; founding_position: number | null; founding_tier?: string | null; newsletter_clicks?: number | null; ownership_status: string };

export type BoardPayload = {
  stats: { claimed: number; total: number };
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
  if (!supabase) return { stats: { claimed: 0, total: 100 }, top: [], rows: [], activity: [] };
  const [board, activity] = await Promise.all([
    supabase.from("newsletters").select("id,slug,title,description,logo_url,logo_source,canonical_url,source_platform,founding_position,founding_tier,ownership_status").eq("ownership_status", "confirmed").not("founding_position", "is", null).order("founding_position", { ascending: true }),
    supabase.from("activity_events").select("id,event_type,created_at,newsletters(title,slug)").eq("approved", true).order("created_at", { ascending: false }).limit(8),
  ]);
  if (board.error) return null;
  const newsletterIds = board.data.map((row) => row.id);
  const clicks = newsletterIds.length ? await supabase.from("newsletter_clicks").select("newsletter_id").in("newsletter_id", newsletterIds) : { data: [], error: null };
  if (clicks.error) return null;
  const clickCounts = new Map<string, number>();
  for (const click of clicks.data ?? []) clickCounts.set(click.newsletter_id, (clickCounts.get(click.newsletter_id) ?? 0) + 1);
  const safeRows = board.data.map((row) => ({ ...row, logo_url: safeExternalUrl(row.logo_url), newsletter_clicks: clickCounts.get(row.id) ?? 0 }));
  return { stats: { claimed: safeRows.length, total: 100 }, top: safeRows.slice(0, 3), rows: safeRows.slice(3), activity: activity.data ?? [] };
}
