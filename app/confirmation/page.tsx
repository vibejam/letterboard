import Link from "next/link";
import { LetterboardMark, Wordmark } from "../components/Brand";
import { Boardmark, type BoardmarkTier } from "../components/Boardmark";

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

  return <main className="site-shell confirmation-page">
    <header className="site-header"><Link className="brand-link" href="/" aria-label="Letterboard home"><Wordmark /></Link><Link className="header-cta" href="/">Return to the board <span>→</span></Link></header>
    <section className="confirmation-card" aria-live="polite">
      <LetterboardMark />
      {confirmed ? <>
        <p className="hero-label">OWNERSHIP CONFIRMED</p>
        <h1>Your Founding 100 place is confirmed.</h1>
        <p className="confirmation-position">{displayPosition}</p>
        <h2>{title}</h2>
        <Boardmark status="confirmed" tier={tier} size="large" />
        <div className="confirmation-actions"><Link className="primary-button" href={`/${slug}`}>View your public profile <span>→</span></Link><Link className="secondary-button" href="/">Return to the board</Link></div>
      </> : <>
        <p className="hero-label">CONFIRMATION LINK UNAVAILABLE</p>
        <h1>This confirmation link is no longer valid.</h1>
        <p>{error === "FOUNDING_100_FULL" ? "The Founding 100 is currently full." : "This link may be expired, already used, or invalid. Your profile remains unchanged."}</p>
        <Link className="primary-button" href="/">Return to the board <span>→</span></Link>
      </>}
    </section>
    <footer className="site-footer"><div className="site-footer__brand"><LetterboardMark /><div><strong>LETTERBOARD</strong><span>The live board for newsletters worth discovering.</span></div></div></footer>
  </main>;
}
