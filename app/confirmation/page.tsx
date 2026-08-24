import Link from "next/link";
import { LetterboardMark, Wordmark } from "../components/Brand";
import { Boardmark, type BoardmarkTier } from "../components/Boardmark";
import { ShareProfileButton } from "../components/ShareProfileButton";

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
  const confirmed = status === "confirmed" && Boolean(slug) && Boolean(position) && Boolean(tier && tiers.has(tier));
  const displayPosition = `#${String(position ?? "01").padStart(2, "0")} · ${(tier ?? "og").toUpperCase()}`;
  const confirmationSummary = `#${String(position ?? "01").padStart(2, "0")} ${(tier ?? "og").toUpperCase()}`;

  return <main className="site-shell confirmation-page">
    <header className="site-header"><Link className="brand-link" href="/" aria-label="Letterboard home"><Wordmark /></Link><Link className="header-cta" href="/">Return to the board <span>→</span></Link></header>
    <section className="confirmation-card" aria-live="polite">
      <LetterboardMark />
      {confirmed ? <>
        <p className="hero-label">FOUNDING STATUS CONFIRMED</p>
        <h1>Your Founding Mark is live.</h1>
        <p>You are confirmed as {confirmationSummary} on Letterboard.</p>
        <p className="confirmation-position">{displayPosition}</p>
        <h2>{title}</h2>
        <Boardmark status="confirmed" tier={tier} size="large" />
        <p className="confirmation-private-note">Internal points stay private. They are never shown on your public profile.</p>
        <p className="confirmation-profile-url">letterboard.lol/{slug}</p>
        <div className="confirmation-actions"><Link className="primary-button" href={`/${slug}`}>View my public profile <span>→</span></Link><ShareProfileButton slug={slug!} /><Link className="secondary-button" href="/">Return to the board</Link></div>
      </> : <>
        <p className="hero-label">CONFIRMATION LINK UNAVAILABLE</p>
        <h1>{error === "MISSING_TOKEN" ? "No confirmation link was provided." : error === "ALREADY_CONFIRMED" ? "This place is already confirmed." : error === "FOUNDING_100_FULL" ? "The Founding 100 is currently full." : error === "CONFIRMATION_FAILED" || error === "RATE_LIMITED" ? "We could not confirm this place." : "This confirmation link is no longer valid."}</h1>
        <p>{error === "MISSING_TOKEN" ? "Open the confirmation link from your email to continue." : error === "ALREADY_CONFIRMED" ? "This Founding Mark is already active. Your profile remains unchanged." : error === "FOUNDING_100_FULL" ? "The Founding 100 is currently full." : error === "CONFIRMATION_FAILED" || error === "RATE_LIMITED" ? "Please try again later or contact support if the problem continues." : "This link may be expired, invalid, or already used. Your profile remains unchanged. Try the link again from your email or contact support."}</p>
        <Link className="primary-button" href="/">Return to the board <span>→</span></Link>
      </>}
    </section>
    <footer className="site-footer"><div className="site-footer__brand"><LetterboardMark /><div><strong>LETTERBOARD</strong><span>The live board for newsletters worth discovering.</span></div></div></footer>
  </main>;
}
