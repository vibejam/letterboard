import type { NewsletterStatus } from "../data/mock";
import { Boardmark, type BoardmarkTier } from "./Boardmark";
import { NewsletterLogo } from "./Brand";
import { ShareProfileButton, type ShareProfileButtonProps } from "./ShareProfileButton";

type ShareCardProps = { name: string; url: string; category: string; description: string; rank?: number | null; status: NewsletterStatus; initials: string; tone: string; logoUrl?: string; tier?: BoardmarkTier; share?: ShareProfileButtonProps };

export function ShareCard({ name, url, category, description, rank, status, initials, tone, logoUrl, tier, share }: ShareCardProps) {
  return <div className="share-card" data-status={status}><div className="share-card__topline"><span>LETTERBOARD</span><span>FOUNDING 100</span></div><div className="share-card__mark"><NewsletterLogo src={logoUrl} alt={`${name} logo`} initials={initials} tone={tone} /><span className="share-card__index">{rank ? `${String(rank).padStart(2, "0")} / 100` : "Position pending"}</span></div><h3>{name}</h3><p>{description}</p><div className="share-card__bottom"><span>{category}</span><Boardmark status={status} tier={tier} size="small" /></div><div className="share-card__url">letterboard.lol/{url.replace(/^www\./, "").split(".")[0]}</div>{share ? <div className="share-card__action"><ShareProfileButton {...share} label="Share this place →" /></div> : null}</div>;
}
