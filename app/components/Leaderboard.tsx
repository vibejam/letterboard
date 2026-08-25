import { capture } from "@/lib/posthog";
import { formatClicks, formatNumber, type BoardActivity, type BoardViewData, type Newsletter } from "../data/mock";
import { Avatar, Boardmark, tierForRank } from "./Boardmark";
import { NewsletterLogo } from "./Brand";
import { safeExternalUrl } from "@/lib/urls";

const safeSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function newsletterDestination(item: Newsletter) {
  if (item.status === "confirmed" && item.slug && safeSlug.test(item.slug)) return `/go/${encodeURIComponent(item.slug)}`;
  return safeExternalUrl(item.url);
}

function trackExternalClick(item: Newsletter) {
  capture("newsletter_external_click", { newsletterId: item.id, slug: item.slug ?? null, outcome: "redirect_requested" });
}

function openCard(event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, item: Newsletter, destination: string | null) {
  if (!destination || (event.target as HTMLElement).closest("a,button")) return;
  if (event.type === "keydown" && (event as React.KeyboardEvent<HTMLElement>).key !== "Enter" && (event as React.KeyboardEvent<HTMLElement>).key !== " ") return;
  event.preventDefault();
  trackExternalClick(item);
  window.open(destination, "_blank", "noopener,noreferrer");
}

function ExternalLink({ item, destination, children, className }: { item: Newsletter; destination: string | null; children: React.ReactNode; className?: string }) {
  if (!destination) return null;
  return <a className={className} href={destination} target="_blank" rel="noopener noreferrer" onClick={() => trackExternalClick(item)}>{children}</a>;
}

function TopCard({ item, rank, onClaim }: { item: Newsletter; rank: number; onClaim: (item?: Newsletter) => void }) {
  const destination = newsletterDestination(item);
  const profilePath = item.slug && safeSlug.test(item.slug) ? `/${encodeURIComponent(item.slug)}` : null;
  const confirmed = item.status === "confirmed" && Boolean(destination);
  return <article className={`top-card ${rank === 1 ? "top-card--first" : ""} ${confirmed ? "top-card--clickable" : ""}`} tabIndex={confirmed ? 0 : undefined} role={confirmed ? "link" : undefined} onClick={(event) => openCard(event, item, destination)} onKeyDown={(event) => openCard(event, item, destination)}>
    <div className="top-card__rank">#{String(rank).padStart(2, "0")}</div>
    {confirmed ? <ExternalLink item={item} destination={destination}><NewsletterLogo src={item.logoUrl} alt={`${item.name} logo`} initials={item.initials} tone={item.tone} /></ExternalLink> : <NewsletterLogo src={item.logoUrl} alt={`${item.name} logo`} initials={item.initials} tone={item.tone} />}
    <div className="top-card__body"><div className="top-card__heading"><div>{confirmed ? <h3><ExternalLink item={item} destination={destination}>{item.name}</ExternalLink></h3> : <h3>{item.name}</h3>}<p>{item.category}</p></div><strong className="top-card__signal">{rank === 1 ? "LIVE ON THE BOARD" : "FOUNDING PLACE"}</strong></div><p className="top-card__description">{item.description}</p><div className="top-card__meta"><span>{item.url}</span><span>{formatClicks(item.clicks)}</span><Boardmark tier={item.foundingTier ?? tierForRank(rank)} size="small" /></div></div>
    <div className="top-card__actions">{confirmed ? <ExternalLink item={item} destination={destination} className="text-button">Read newsletter <span aria-hidden="true">↗</span></ExternalLink> : profilePath ? <a className="text-button" href={profilePath}>View public profile <span aria-hidden="true">→</span></a> : <button className="text-button" onClick={() => onClaim(item)}>View profile <span aria-hidden="true">→</span></button>}{profilePath && <a className="text-button top-card__profile-link" href={profilePath} onClick={(event) => event.stopPropagation()}>View profile <span aria-hidden="true">→</span></a>}</div>
  </article>;
}

function BoardRow({ item, rank, onClaim }: { item: Newsletter; rank: number; onClaim: (item?: Newsletter) => void }) {
  const contents = <>
    <span className="board-row__rank">{String(rank).padStart(2, "0")}</span>
    <span className="board-row__name"><NewsletterLogo src={item.logoUrl} alt={`${item.name} logo`} initials={item.initials} tone={item.tone} /><strong>{item.name}</strong></span>
    <span>{item.category}</span>
    <span>{formatNumber(item.clicks)}</span>
    <span className="board-row__status"><Boardmark tier={item.foundingTier ?? tierForRank(rank)} size="small" /><span>Confirmed Founding Mark</span><span aria-hidden="true">→</span></span>
  </>;
  if (item.status === "confirmed") {
    const destination = newsletterDestination(item);
    return destination ? <a className="board-row" href={destination} target="_blank" rel="noopener noreferrer" onClick={() => trackExternalClick(item)}>{contents}</a> : <div className="board-row">{contents}</div>;
  }
  return <button className="board-row" type="button" onClick={() => onClaim(item)}>{contents}</button>;
}

export function ActivityPanel({ events }: { events: BoardActivity[] }) {
  return <section className="activity-grid" aria-label="Live board activity">
    <div className="activity-panel"><div className="panel-kicker"><span className="kicker-star">✦</span> Trending in the inbox</div><div className="activity-list">{events.length ? events.slice(0, 4).map((event) => <div className="activity-row" key={`${event.name}-${event.time}`}><Avatar initials={event.name.slice(0, 1)} tone={event.tone} /><strong>{event.name}</strong><span>{event.detail}</span></div>) : <p className="activity-empty">Nothing yet. You could start it.</p>}</div></div>
    <div className="activity-panel"><div className="panel-kicker"><span className="live-dot" /> Latest activity</div><div className="activity-list">{events.length ? events.map((event) => <div className="activity-row" key={`${event.name}-${event.time}`}><Avatar initials={event.name.slice(0, 1)} tone={event.tone} /><strong>{event.name}</strong><span>{event.time}</span></div>) : <p className="activity-empty">Nothing yet. You could start it.</p>}</div></div>
  </section>;
}

export function Leaderboard({ onClaim, data }: { onClaim: (item?: Newsletter) => void; data: BoardViewData }) {
  const [first, second, third] = data.leaderboard;
  const { stats } = data;
  return <section className="board-section" id="board" aria-labelledby="board-title">
    <div className="section-intro section-intro--compact"><div><p className="eyebrow">THE LIVE BOARD</p><h2 id="board-title">{data.leaderboard.length ? "The live board." : "Who gets there first?"}</h2></div><p className="section-note">{data.leaderboard.length ? `#01 is held. The next founding place is waiting at #${String(stats.claimed + 1).padStart(2, "0")}.` : "Letterboard starts empty. The first verified newsletter takes #01."}</p></div>
    {data.leaderboard.length > 0 ? <><div className="top-stack" aria-label="Top three founding newsletters"><div className="top-stack__label">TOP 3</div>{first && <TopCard item={first} rank={1} onClaim={onClaim} />}{second && <TopCard item={second} rank={2} onClaim={onClaim} />}{third && <TopCard item={third} rank={3} onClaim={onClaim} />}</div><div className="board-table" aria-label="Founding 100 newsletter leaderboard"><div className="table-heading"><span>FOUNDING PLACE</span><span>NEWSLETTER</span><span>TOPIC</span><span>CLICKS</span><span>STATUS</span></div>{data.leaderboard.slice(3).map((item, index) => <BoardRow item={item} rank={index + 4} onClaim={onClaim} key={item.id} />)}</div></> : <div className="empty-board" role="status"><Boardmark status="pending" size="large" /><h3>Who gets there first?</h3><p>Letterboard starts empty. The first verified newsletter takes #01.</p><button className="primary-button" onClick={() => onClaim()}>Claim #01 <span>→</span></button></div>}
    <div className="board-footer-line"><span>{stats.claimed} of {stats.total} {stats.claimed === 1 ? "spot" : "spots"} claimed</span><button className="text-button" onClick={() => onClaim()}>Claim my spot <span aria-hidden="true">→</span></button></div>
  </section>;
}
