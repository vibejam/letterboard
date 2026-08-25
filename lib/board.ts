import { getSupabaseAdmin } from "./supabaseAdmin";
import { safeExternalUrl } from "./urls";

export type BoardPayload = {
  stats: { claimed: number; total: number };
  top: Array<{ id: string; slug: string; title: string; description?: string | null; logo_url?: string | null; logo_source?: string | null; canonical_url: string; source_platform?: string | null; founding_position: number | null; founding_tier?: string | null; profile_views?: number | null; ownership_status: string }>;
  rows: Array<{ id: string; slug: string; title: string; description?: string | null; logo_url?: string | null; logo_source?: string | null; canonical_url: string; source_platform?: string | null; founding_position: number | null; founding_tier?: string | null; profile_views?: number | null; ownership_status: string }>;
  activity: Array<{ id: number; event_type: string; created_at: string; newsletters?: { title?: string; slug?: string } | { title?: string; slug?: string }[] | null }>;
};

export async function getBoardPayload(): Promise<BoardPayload | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { stats: { claimed: 0, total: 100 }, top: [], rows: [], activity: [] };
  const [board, activity] = await Promise.all([
    supabase.from("newsletters").select("id,slug,title,description,logo_url,logo_source,canonical_url,source_platform,founding_position,founding_tier,profile_views,ownership_status").eq("ownership_status", "confirmed").not("founding_position", "is", null).order("founding_position", { ascending: true }),
    supabase.from("activity_events").select("id,event_type,created_at,newsletters(title,slug)").eq("approved", true).order("created_at", { ascending: false }).limit(8),
  ]);
  if (board.error) return null;
  const safeRows = board.data.map((row) => ({ ...row, logo_url: safeExternalUrl(row.logo_url) }));
  return { stats: { claimed: safeRows.length, total: 100 }, top: safeRows.slice(0, 3), rows: safeRows.slice(3), activity: activity.data ?? [] };
}
