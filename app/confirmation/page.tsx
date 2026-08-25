import Link from "next/link";
import { LetterboardMark, Wordmark } from "../components/Brand";
import { Boardmark, type BoardmarkTier } from "../components/Boardmark";
import { ShareProfileButton } from "../components/ShareProfileButton";
import { PlatformVerificationPanel } from "../components/PlatformVerificationPanel";
import { SpreadTheWord } from "../components/SpreadTheWord";
import { safeExternalUrl } from "@/lib/urls";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type ConfirmationPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const tiers = new Set<BoardmarkTier>(["og", "legend", "icon", "pioneer"]);

function valueOf(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function ConfirmationPage({ searchParams }: ConfirmationPageProps) {
  const params = await searchParams;
  const status = valueOf(params.status);
  const error = valueOf(params.error);
  const slug = valueOf(params.slug)?.match(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)?.[0];
  const title = valueOf(params.title) || "Build the Smallest Honest Signal";
  const position = valueOf(params.position)?.match(/^\d{1,3}$/)?.[0];
  const tier = valueOf(params.tier)?.toLowerCase() as BoardmarkTier | undefined;
  const sourcePlatform = valueOf(params.sourcePlatform);
  const newsletterUrl = safeExternalUrl(valueOf(params.newsletterUrl));
  const manualPlatformReview = valueOf(params.review) === "platform";
  const supabase = getSupabaseAdmin();
  const confirmedNewsletter = status === "confirmed" && slug && supabase
    ? await supabase.from("newsletters").select("id,slug,title,canonical_url,source_platform,founding_position,founding_tier,ownership_status").eq("slug", slug).eq("ownership_status", "confirmed").maybeSingle()
    : { data: null };
  const confirmedProfile = confirmedNewsletter.data?.id && supabase
    ? await supabase.from("public_profiles").select("is_published").eq("newsletter_id", confirmedNewsletter.data.id).eq("is_published", true).maybeSingle()
    : { data: null };
  const confirmed = Boolean(confirmedNewsletter.data && confirmedProfile.data?.is_published && confirmedNewsletter.data.founding_position && confirmedNewsletter.data.founding_tier && tiers.has(confirmedNewsletter.data.founding_tier as BoardmarkTier));
  const pendingNewsletter = status === "email_verified" && slug && supabase
    ? await supabase.from("newsletters").select("id,slug,title,canonical_url,source_platform,founding_position,logo_url,ownership_status").eq("slug", slug).eq("ownership_status", "pending").maybeSingle()
    : { data: null };
  const actualSlug = confirmedNewsletter.data?.slug ?? slug;
  const actualTitle = confirmedNewsletter.data?.title ?? title;
  const actualPosition = confirmedNewsletter.data?.founding_position ?? Number(position ?? 0);
  const actualTier = (confirmedNewsletter.data?.founding_tier ?? tier) as BoardmarkTier | undefined;
  const actualSourcePlatform = confirmedNewsletter.data?.source_platform ?? sourcePlatform;
  const actualNewsletterUrl = safeExternalUrl(confirmedNewsletter.data?.canonical_url) ?? newsletterUrl;
  const displayPosition = `#${String(actualPosition || 1).padStart(2, "0")} · ${(actualTier ?? "og").toUpperCase()}`;
  const confirmationSummary = `#${String(actualPosition || 1).padStart(2, "0")} ${(actualTier ?? "og").toUpperCase()}`;

  return <main className="site-shell confirmation-page">
    <header className="site-header"><Link className="brand-link" href="/" aria-label="Letterboard home"><Wordmark /></Link><Link className="header-cta" href="/">Return to the board <span>→</span></Link></header>
    <section className="confirmation-card" aria-live="polite">
      <LetterboardMark />
      {confirmed ? <>
        <p className="hero-label">FOUNDING STATUS CONFIRMED</p>
        <h1>Your Founding Mark is live.</h1>
        <p>You are confirmed as {confirmationSummary} on Letterboard.</p>
        <p className="confirmation-position">{displayPosition}</p>
        <h2>{actualTitle}</h2>
        <Boardmark status="confirmed" tier={actualTier} size="large" />
        <p className="confirmation-private-note">Internal points stay private. They are never shown on your public profile.</p>
        <p className="confirmation-profile-url">letterboard.lol/{actualSlug}</p>
        <div className="confirmation-actions"><Link className="primary-button" href={`/${actualSlug}`}>View my public profile <span>→</span></Link>{actualNewsletterUrl ? <a className="secondary-button" href={actualNewsletterUrl} target="_blank" rel="noopener noreferrer">Open newsletter <span>↗</span></a> : null}<ShareProfileButton slug={actualSlug!} newsletterName={actualTitle} foundingPosition={Number(actualPosition)} tier={actualTier!} sourcePlatform={actualSourcePlatform} newsletterUrl={actualNewsletterUrl} /><Link className="secondary-button" href="/">Return to the board</Link></div>
      </> : status === "email_verified" && manualPlatformReview ? <PlatformVerificationPanel newsletterName={pendingNewsletter.data?.title ?? title} sourcePlatform={pendingNewsletter.data?.source_platform ?? sourcePlatform ?? "independent"} newsletterUrl={safeExternalUrl(pendingNewsletter.data?.canonical_url) ?? newsletterUrl ?? undefined} /> : status === "email_verified" ? <SpreadTheWord newsletterId={pendingNewsletter.data?.id} slug={pendingNewsletter.data?.slug ?? slug} title={pendingNewsletter.data?.title ?? title} canonicalUrl={pendingNewsletter.data?.canonical_url ?? newsletterUrl} sourcePlatform={pendingNewsletter.data?.source_platform ?? sourcePlatform} foundingPosition={pendingNewsletter.data?.founding_position} logoUrl={pendingNewsletter.data?.logo_url} /> : <>
        <p className="hero-label">CONFIRMATION LINK UNAVAILABLE</p>
        <h1>{error === "MISSING_TOKEN" ? "No confirmation link was provided." : error === "ALREADY_CONFIRMED" ? "This place is already confirmed." : error === "CREATOR_BANNED" ? "This place cannot be confirmed." : error === "FOUNDING_100_FULL" ? "The Founding 100 is currently full." : error === "CONFIRMATION_FAILED" || error === "RATE_LIMITED" ? "We could not confirm this place." : "This confirmation link is no longer valid."}</h1>
        <p>{error === "MISSING_TOKEN" ? "Open the confirmation link from your email to continue." : error === "ALREADY_CONFIRMED" ? "This Founding Mark is already active. Your profile remains unchanged." : error === "CREATOR_BANNED" ? "This creator identity is not eligible for Founding 100 confirmation. Contact support if you believe this is an error." : error === "FOUNDING_100_FULL" ? "The Founding 100 is currently full." : error === "CONFIRMATION_FAILED" || error === "RATE_LIMITED" ? "Please try again later or contact support if the problem continues." : "This link may be expired, invalid, or already used. Your profile remains unchanged. Try the link again from your email or contact support."}</p>
        <Link className="primary-button" href="/">Return to the board <span>→</span></Link>
      </>}
    </section>
    <footer className="site-footer"><div className="site-footer__brand"><LetterboardMark /><div><strong>LETTERBOARD</strong><span>The live board for newsletters worth discovering.</span></div></div></footer>
  </main>;
}
