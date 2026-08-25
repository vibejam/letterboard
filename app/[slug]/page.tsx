import { notFound } from "next/navigation";
import Link from "next/link";
import { Boardmark, type BoardmarkTier } from "../components/Boardmark";
import { LetterboardMark, NewsletterLogo, Wordmark } from "../components/Brand";
import { ShareCard } from "../components/ShareCard";
import { ShareProfileButton } from "../components/ShareProfileButton";
import { getNewsletterClickCount } from "@/lib/board";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { inferSharePlatformFromCanonicalUrl } from "@/lib/share";
import { safeExternalUrl } from "@/lib/urls";

export const dynamic = "force-dynamic";

type ProfilePageProps = { params: Promise<{ slug: string }> };
const tiers = new Set<BoardmarkTier>(["og", "legend", "icon", "pioneer"]);

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) notFound();
  const result = await supabase.from("newsletters").select("id,slug,title,description,logo_url,logo_source,canonical_url,source_platform,founding_position,founding_tier,ownership_status,boardmark_status").eq("slug", slug).eq("ownership_status", "confirmed").maybeSingle();
  if (result.error || !result.data) notFound();
  const published = await supabase.from("public_profiles").select("is_published").eq("newsletter_id", result.data.id).eq("is_published", true).maybeSingle();
  if (published.error || !published.data) notFound();
  const clicks = await getNewsletterClickCount(supabase, result.data.id);
  if (clicks === null) notFound();
  const tier = tiers.has(result.data.founding_tier as BoardmarkTier) ? result.data.founding_tier as BoardmarkTier : undefined;
  const externalUrl = safeExternalUrl(result.data.canonical_url);
  const initials = result.data.title.slice(0, 1).toUpperCase();
  const inferredPlatform = inferSharePlatformFromCanonicalUrl(result.data.canonical_url);
  const sourcePlatform = result.data.source_platform ?? (inferredPlatform === "unknown" ? null : inferredPlatform);
  const category = sourcePlatform ?? "Newsletter";
  return <main className="site-shell profile-page">
    <header className="site-header"><Link className="brand-link" href="/" aria-label="Letterboard home"><Wordmark /></Link><Link className="header-cta" href="/#board">Return to the board <span>→</span></Link></header>
    <section className="public-profile-card">
      <p className="hero-label">PUBLIC PROFILE / CONFIRMED</p>
      <div className="public-profile-card__heading"><NewsletterLogo src={safeExternalUrl(result.data.logo_url)} alt={`${result.data.title} logo`} initials={initials} /><div><h1>{result.data.title}</h1><p>{result.data.canonical_url}</p></div></div>
      <Boardmark status="confirmed" tier={tier} size="large" />
      <p className="public-profile-card__description">{result.data.description ?? "A public newsletter on Letterboard."}</p>
      <div className="public-profile-card__meta"><span><strong>#{String(result.data.founding_position).padStart(2, "0")}</strong><small>Founding place</small></span><span><strong>{String(result.data.founding_tier).toUpperCase()}</strong><small>Founding Mark tier</small></span><span><strong>{clicks.toLocaleString("en-US")}</strong><small>{clicks === 1 ? "Newsletter click" : "Newsletter clicks"}</small></span></div>
      <div className="profile-primary-actions">{externalUrl ? <a className="primary-button" href={externalUrl} target="_blank" rel="noopener noreferrer">Read newsletter <span>↗</span></a> : <span className="form-note">The newsletter link is temporarily unavailable.</span>}<ShareProfileButton slug={slug} newsletterName={result.data.title} foundingPosition={result.data.founding_position ?? 0} tier={tier ?? "og"} sourcePlatform={sourcePlatform} newsletterUrl={externalUrl} /></div>
    </section>
    <section className="profile-share-section"><div><p className="eyebrow">SHARE CARD</p><h2>Make the founding place visible.</h2><p>Share the confirmed profile and Founding Mark wherever people discover your newsletter.</p></div><ShareCard name={result.data.title} url={slug} category={category} description={result.data.description ?? "A public newsletter on Letterboard."} rank={result.data.founding_position ?? 0} status="confirmed" tier={tier} initials={initials} tone="paper" logoUrl={safeExternalUrl(result.data.logo_url) ?? undefined} share={{ slug, newsletterName: result.data.title, foundingPosition: result.data.founding_position ?? 0, tier: tier ?? "og", sourcePlatform, newsletterUrl: externalUrl }} /></section>
    <footer className="site-footer"><div className="site-footer__brand"><LetterboardMark /><div><strong>LETTERBOARD</strong><span>The live board for newsletters worth discovering.</span></div></div></footer>
  </main>;
}
