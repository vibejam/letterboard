"use client";

import { useState } from "react";
import { ClaimFlow } from "./components/ClaimFlow";
import { LetterboardMark, Wordmark } from "./components/Brand";
import { ActivityPanel, Leaderboard } from "./components/Leaderboard";
import { boardStats, type Newsletter } from "./data/mock";

export default function Home() {
  const [claimOpen, setClaimOpen] = useState(false);
  const [selectedNewsletter, setSelectedNewsletter] = useState<Newsletter | undefined>();
  function openClaim(newsletter?: Newsletter) { setSelectedNewsletter(newsletter); setClaimOpen(true); }

  return <main className="site-shell">
    <header className="site-header"><a className="brand-link" href="#top" aria-label="Letterboard home"><Wordmark /></a><nav className="site-nav" aria-label="Primary navigation"><a className="site-nav__active" href="#board">Leaderboard</a><a href="#how-it-works">How it works</a></nav><button className="header-cta" onClick={() => openClaim()}>Claim your spot <span>→</span></button></header>
    <div className="live-strip"><span className="live-dot" /><strong>{boardStats.online} online</strong><span>·</span><span>{boardStats.claimed} places claimed</span><span>·</span><span>{boardStats.total - boardStats.claimed} places open</span><span className="live-strip__stats">{boardStats.visitors.toLocaleString()} visitors since launch <span>→</span></span></div>
    <section className="hero" id="top"><div className="hero__content"><p className="hero-label">THE FOUNDING 100 IS OPEN</p><h1>Claim a place on the Founding 100.</h1><p className="hero__lede">Free public profile. Founding Boardmark. No payment.</p><button className="hero-claim-bar" onClick={() => openClaim()}><span>Newsletter URL</span><strong>Claim your spot <span>→</span></strong></button><p className="hero__helper">The first three founding places carry the weight of the board.</p></div></section>
    <Leaderboard onClaim={openClaim} />
    <ActivityPanel />
    <section className="board-intro-strip"><div><strong>Founding 100</strong><span>Free public profiles for the first newsletters shaping the board.</span></div><div><strong>{boardStats.claimed} / {boardStats.total}</strong><span>places claimed</span></div><div><strong>Next phase</strong><span>Spotlight placement after 100 confirmed profiles.</span></div></section>
    <section className="how-section" id="how-it-works"><div><p className="eyebrow">HOW THE BOARD WORKS</p><h2>Simple in. Visible out.</h2></div><div className="how-grid"><article><span>01</span><h3>Share a URL</h3><p>Letterboard pulls the public details into a profile for you.</p></article><article><span>02</span><h3>Confirm ownership</h3><p>A one-click email activates your Boardmark and public status.</p></article><article><span>03</span><h3>Share your place</h3><p>Your public profile becomes part of the live board readers can explore.</p></article></div></section>
    <footer className="site-footer"><div className="site-footer__brand"><LetterboardMark /><div><strong>LETTERBOARD</strong><span>The live board for newsletters worth discovering.</span></div></div><div className="site-footer__tagline">Get on the board. Move up the board. Own the inbox.</div><div className="site-footer__meta"><span>© 2026 Letterboard</span><button onClick={() => openClaim()}>Claim your spot <span>→</span></button></div></footer>
    <ClaimFlow open={claimOpen} onClose={() => { setClaimOpen(false); setSelectedNewsletter(undefined); }} initialNewsletter={selectedNewsletter} />
  </main>;
}
