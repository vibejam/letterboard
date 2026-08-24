import { activity, boardStats, formatNumber, leaderboard, type Newsletter } from "../data/mock";
import { Avatar, Boardmark, tierForRank } from "./Boardmark";

function TopCard({ item, rank, onClaim }: { item: Newsletter; rank: number; onClaim: (item?: Newsletter) => void }) {
  return <article className={`top-card ${rank === 1 ? "top-card--first" : ""}`}>
    <div className="top-card__rank">#{String(rank).padStart(2, "0")}</div><Avatar initials={item.initials} tone={item.tone} />
    <div className="top-card__body"><div className="top-card__heading"><div><h3>{item.name}</h3><p>{item.category}</p></div><strong className="top-card__signal">{rank === 1 ? "FIRST ON THE BOARD" : "FOUNDING PLACE"}</strong></div><p className="top-card__description">{item.description}</p><div className="top-card__meta"><span>{item.url}</span><span>{formatNumber(item.clicks)} profile views</span><Boardmark tier={item.foundingTier ?? tierForRank(rank)} size="small" /></div></div>
    <button className="text-button" onClick={() => onClaim(item)}>View profile <span aria-hidden="true">→</span></button>
  </article>;
}

export function ActivityPanel() {
  return <section className="activity-grid" aria-label="Live board activity">
    <div className="activity-panel"><div className="panel-kicker"><span className="kicker-star">✦</span> Trending in the inbox</div><div className="activity-list">{leaderboard.slice(0, 4).map((item, index) => <div className="activity-row" key={item.id}><Avatar initials={item.initials} tone={item.tone} /><strong>{item.name}</strong><span>{index === 0 ? "first on the board" : item.category}</span></div>)}</div></div>
    <div className="activity-panel"><div className="panel-kicker"><span className="live-dot" /> Latest activity</div><div className="activity-list">{activity.map((event) => <div className="activity-row" key={`${event.name}-${event.time}`}><Avatar initials={event.name.slice(0, 1)} tone={event.tone} /><strong>{event.name}</strong><span>{event.time}</span></div>)}</div></div>
  </section>;
}

export function Leaderboard({ onClaim }: { onClaim: (item?: Newsletter) => void }) {
  const [first, second, third] = leaderboard;
  return <section className="board-section" id="board" aria-labelledby="board-title">
    <div className="section-intro section-intro--compact"><div><p className="eyebrow">THE LIVE BOARD</p><h2 id="board-title">First on Letterboard.</h2></div><p className="section-note">The first three founding places carry the weight of the board.</p></div>
    {leaderboard.length > 0 ? <><div className="top-stack" aria-label="Top three founding newsletters"><div className="top-stack__label">TOP 3</div>{first && <TopCard item={first} rank={1} onClaim={onClaim} />}{second && <TopCard item={second} rank={2} onClaim={onClaim} />}{third && <TopCard item={third} rank={3} onClaim={onClaim} />}</div><div className="board-table" aria-label="Founding 100 newsletter leaderboard"><div className="table-heading"><span>FOUNDING PLACE</span><span>NEWSLETTER</span><span>TOPIC</span><span>VIEWS</span><span>STATUS</span></div>{leaderboard.slice(3).map((item, index) => <button className="board-row" key={item.id} onClick={() => onClaim(item)}><span className="board-row__rank">{String(index + 4).padStart(2, "0")}</span><span className="board-row__name"><Avatar initials={item.initials} tone={item.tone} /><strong>{item.name}</strong></span><span>{item.category}</span><span>{formatNumber(item.clicks)}</span><span className="board-row__status"><Boardmark tier={item.foundingTier ?? tierForRank(index + 4)} size="small" /><span>Confirmed</span><span aria-hidden="true">→</span></span></button>)}</div></> : <div className="empty-board" role="status"><Boardmark status="pending" size="large" /><h3>The board is waiting for its first newsletter.</h3><p>Claim the first Founding 100 place and become #01.</p><button className="primary-button" onClick={() => onClaim()}>Claim your spot <span>→</span></button></div>}
    <div className="board-footer-line"><span>{boardStats.claimed} of {boardStats.total} places claimed</span><button className="text-button" onClick={() => onClaim()}>Claim your spot <span aria-hidden="true">→</span></button></div>
  </section>;
}
