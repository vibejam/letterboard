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
    <p className="spread-word-panel__lede">If you want to help your publication reach more of the right readers, share your place on Letterboard. Sharing is optional, and sharing from the publication’s own account gives us another helpful signal that we are speaking with the right creator.</p>
    <div className="spread-word-panel__publication"><NewsletterLogo src={safeExternalUrl(logoUrl)} alt={`${title} logo`} initials={initials} /><div><strong>{title}</strong><span>{platformLabel(platform)}</span></div>{foundingPosition ? <b>#{String(foundingPosition).padStart(2, "0")}</b> : <b>Pending review</b>}</div>
    <p className="spread-word-panel__note">Email confirmation proves control of the inbox only. Your Founding Mark and public profile activate after Letterboard review. Sharing is a signal, not proof by itself.</p>
    <div className="spread-word-panel__actions">{slug ? <ShareProfileButton slug={slug} newsletterId={newsletterId} newsletterName={title} foundingPosition={foundingPosition} sourcePlatform={platform} newsletterUrl={externalUrl} claimState="pending_review" label="Share my place" /> : null}<Link className="secondary-button" href="/">Maybe later</Link><Link className="secondary-button" href="/#board">Return to the board</Link></div>
  </div>;
}
