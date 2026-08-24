import type { NewsletterStatus } from "../data/mock";
import { Avatar, Boardmark, type BoardmarkTier } from "./Boardmark";

type ShareCardProps = { name: string; url: string; category: string; description: string; rank: number; status: NewsletterStatus; initials: string; tone: string; tier?: BoardmarkTier };

export function ShareCard({ name, url, category, description, rank, status, initials, tone, tier }: ShareCardProps) {
  return <div className="share-card" data-status={status}><div className="share-card__topline"><span>LETTERBOARD</span><span>FOUNDING 100</span></div><div className="share-card__mark"><Avatar initials={initials} tone={tone} /><span className="share-card__index">{String(rank).padStart(2, "0")} / 100</span></div><h3>{name}</h3><p>{description}</p><div className="share-card__bottom"><span>{category}</span><Boardmark status={status} tier={tier} size="small" /></div><div className="share-card__url">letterboard.co/{url.replace(/^www\./, "").split(".")[0]}</div></div>;
}
