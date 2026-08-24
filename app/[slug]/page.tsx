import { notFound } from "next/navigation";
import Link from "next/link";
import { Boardmark, type BoardmarkTier } from "../components/Boardmark";
import { LetterboardMark, Wordmark } from "../components/Brand";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type ProfilePageProps = { params: Promise<{ slug: string }> };
const tiers = new Set<BoardmarkTier>(["og", "legend", "icon", "pioneer"]);

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) notFound();
  const result = await supabase.from("newsletters").select("id,slug,title,description,logo_url,canonical_url,source_platform,founding_position,founding_tier,profile_views,ownership_status,boardmark_status").eq("slug", slug).eq("ownership_status", "confirmed").maybeSingle();
  if (result.error || !result.data) notFound();
  const published = await supabase.from("public_profiles").select("is_published").eq("newsletter_id", result.data.id).eq("is_published", true).maybeSingle();
  if (published.error || !published.data) notFound();
  const tier = tiers.has(result.data.founding_tier as BoardmarkTier) ? result.data.founding_tier as BoardmarkTier : undefined;
  return <main className="site-shell profile-page">
    <header className="site-header"><Link className="brand-link" href="/" aria-label="Letterboard home"><Wordmark /></Link><Link className="header-cta" href="/#board">Return to the board <span>→</span></Link></header>
    <section className="public-profile-card"><p className="hero-label">PUBLIC PROFILE / CONFIRMED</p><div className="public-profile-card__heading"><LetterboardMark /><div><h1>{result.data.title}</h1><p>{result.data.canonical_url}</p></div></div><Boardmark status="confirmed" tier={tier} size="large" /><p className="public-profile-card__description">{result.data.description}</p><div className="public-profile-card__meta"><span><strong>#{String(result.data.founding_position).padStart(2, "0")}</strong><small>Founding place</small></span><span><strong>{String(result.data.founding_tier).toUpperCase()}</strong><small>Founding Mark tier</small></span><span><strong>Confirmed</strong><small>Ownership status</small></span></div></section>
    <footer className="site-footer"><div className="site-footer__brand"><LetterboardMark /><div><strong>LETTERBOARD</strong><span>The live board for newsletters worth discovering.</span></div></div></footer>
  </main>;
}
