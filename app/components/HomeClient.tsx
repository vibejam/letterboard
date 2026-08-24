"use client";

import { useEffect, useState } from "react";
import { ClaimFlow } from "./ClaimFlow";
import { LetterboardMark, Wordmark } from "./Brand";
import { ActivityPanel, Leaderboard } from "./Leaderboard";
import { defaultBoardViewData, mapBoardActivity, mapBoardRow, type BoardViewData, type Newsletter } from "../data/mock";

export default function HomeClient({ initialBoard }: { initialBoard: BoardViewData }) {
  const [claimOpen, setClaimOpen] = useState(false);
  const [selectedNewsletter, setSelectedNewsletter] = useState<Newsletter | undefined>();
  const [board, setBoard] = useState<BoardViewData>(initialBoard ?? defaultBoardViewData);
  useEffect(() => {
    let active = true;
    fetch("/api/board", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("BOARD_UNAVAILABLE");
      const result = await response.json() as { stats: BoardViewData["stats"]; top: Parameters<typeof mapBoardRow>[0][]; rows: Parameters<typeof mapBoardRow>[0][]; activity: Parameters<typeof mapBoardActivity>[0][] };
      if (active) setBoard({ stats: result.stats, leaderboard: [...result.top, ...result.rows].map(mapBoardRow), activity: result.activity.map(mapBoardActivity) });
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  function openClaim(newsletter?: Newsletter) { setSelectedNewsletter(newsletter); setClaimOpen(true); }

  return <main className="site-shell">
    <header className="site-header"><a className="brand-link" href="#top" aria-label="Letterboard home"><Wordmark /></a><nav className="site-nav" aria-label="Primary navigation"><a className="site-nav__active" href="#board">Leaderboard</a><a href="#how-it-works">How it works</a></nav><button className="header-cta" onClick={() => openClaim()}>Claim your spot <span>→</span></button></header>
    <div className="live-strip"><span className="live-dot" /><strong>FOUNDING 100</strong><span>·</span><span>{board.stats.claimed} {board.stats.claimed === 1 ? "place" : "places"} claimed</span><span>·</span><span>{board.stats.total - board.stats.claimed} {board.stats.total - board.stats.claimed === 1 ? "place" : "places"} open</span></div>
    <section className="hero" id="top"><div className="hero__content"><p className="hero-label">THE FOUNDING 100 IS OPEN</p><h1>Be one of the first 100 newsletters on Letterboard.</h1><p className="hero__lede">Claim your permanent founding position, build your public profile, and be there before the leaderboard opens to the world.</p><p className="hero__trust">Free forever to claim. No card. No catch.</p><button className="hero-claim-bar" onClick={() => openClaim()}><span>Paste your newsletter URL</span><strong>Claim my spot <span>→</span></strong></button><p className="hero__helper">Your place is reserved after email confirmation.</p><p className="hero__tiers">#1–5 OG · #6–10 Legend · #11–50 Icon · #51–100 Pioneer · The first 100 keep their Founding Mark permanently.</p></div></section>
    <Leaderboard onClaim={openClaim} data={board} />
    <ActivityPanel events={board.activity} />
    <section className="board-intro-strip"><div><strong>Founding 100</strong><span>The first 100 verified newsletters become permanent founding members of Letterboard.</span></div><div><strong>{board.stats.claimed} / 100</strong><span>Founding spots claimed</span></div><div><strong>NEXT → SPOTLIGHT</strong><span>After the Founding 100 closes, Spotlight opens for featured visibility without changing organic founding status.</span></div></section>
    <section className="how-section" id="how-it-works"><div><p className="eyebrow">HOW THE BOARD WORKS</p><h2>Simple in. Visible out.</h2></div><div className="how-grid"><article><span>01</span><h3>Paste your newsletter</h3><p>Drop in your URL. Letterboard builds the public profile.</p></article><article><span>02</span><h3>Prove it’s yours</h3><p>Confirm by email to secure your position and Founding Mark.</p></article><article><span>03</span><h3>Get on the board</h3><p>Your newsletter goes live, gets discovered and starts building its place in the ranking.</p></article></div></section>
    <footer className="site-footer"><div className="site-footer__brand"><LetterboardMark /><div><strong>LETTERBOARD</strong><span>The live board for newsletters worth discovering.</span></div></div><div className="site-footer__tagline">Get on the board. Move up the board. Own the inbox.</div><div className="site-footer__meta"><span>© 2026 Letterboard</span><button onClick={() => openClaim()}>Claim your spot <span>→</span></button></div></footer>
    <ClaimFlow key={`${claimOpen}-${selectedNewsletter?.id ?? "new"}`} open={claimOpen} onClose={() => { setClaimOpen(false); setSelectedNewsletter(undefined); }} initialNewsletter={selectedNewsletter} boardStatsOverride={board.stats} />
  </main>;
}
