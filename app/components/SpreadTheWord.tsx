import Link from "next/link";
import { NewsletterLogo } from "./Brand";
import { ShareProfileButton } from "./ShareProfileButton";
import { inferVerifiedPlatform } from "@/lib/platform";
import { safeExternalUrl } from "@/lib/urls";

function platformLabel(value: string) {
  if (value === "substack") return "Substack";
  if (value === "medium") return "Medium";
  if (value === "x") return "X";
  if (value === "linkedin") return "LinkedIn";
  if (value === "beehiiv") return "beehiiv";
  if (value === "independent") return "Independent publication";
  return "Publication";
}

export function SpreadTheWord({
  newsletterId,
  slug,
  title,
  canonicalUrl,
  sourcePlatform,
  foundingPosition,
  logoUrl,
}: {
  newsletterId?: string;
  slug?: string;
  title: string;
  canonicalUrl?: string | null;
  sourcePlatform?: string | null;
  foundingPosition?: number | null;
  logoUrl?: string | null;
}) {
  const platform = inferVerifiedPlatform(sourcePlatform, canonicalUrl);
  const externalUrl = safeExternalUrl(canonicalUrl);
  const initials = title.slice(0, 1).toUpperCase();
  return <div className="spread-word-panel">
    <p className="hero-label">FOUNDING 100 / OPTIONAL</p>
    <h1>Spread the word</h1>
    <p className="spread-word-panel__lede">You’ve secured an early place on Letterboard’s Founding 100 — the first 100 newsletters on the board. Share your place with your readers and let them see what you’ve claimed.</p>
    <div className="spread-word-panel__publication"><NewsletterLogo src={safeExternalUrl(logoUrl)} alt={`${title} logo`} initials={initials} /><div><strong>{title}</strong><span>{platformLabel(platform)}</span></div>{foundingPosition ? <b>#{String(foundingPosition).padStart(2, "0")}</b> : <b>Pending review</b>}</div>
    <p className="spread-word-panel__note">Sharing is optional. Your place is already reserved.</p>
    <div className="spread-word-panel__actions">{slug ? <ShareProfileButton slug={slug} newsletterId={newsletterId} newsletterName={title} foundingPosition={foundingPosition} sourcePlatform={platform} newsletterUrl={externalUrl} claimState="pending_review" label="Share my place" /> : null}<Link className="secondary-button" href="/">Maybe later</Link><Link className="secondary-button" href="/#board">Return to the board</Link></div>
  </div>;
}
