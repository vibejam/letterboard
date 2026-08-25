"use client";

import { useState } from "react";

type PlatformVerificationPanelProps = { newsletterName: string; sourcePlatform: string; newsletterUrl?: string };

function readablePlatform(platform: string) {
  if (platform === "substack") return "Substack publication";
  if (platform === "medium") return "Medium publication or author page";
  if (platform === "x") return "X profile";
  if (platform === "linkedin") return "LinkedIn public profile or page";
  if (platform === "independent") return "custom publication domain";
  return platform;
}

function placementCopy(platform: string, dnsRecord?: string, newsletterUrl?: string) {
  if (platform === "substack") return "Add this code to your Substack About page or a public Note. Do not publish it anywhere you do not control.";
  if (platform === "medium") return "Add this code to the public bio or publication page connected to this newsletter.";
  if (platform === "x") return "Add this code to the public bio of the X profile that controls this publication.";
  if (platform === "linkedin") return "Add this code to the public About or headline section of the LinkedIn profile or page that controls this publication.";
  return <>Add a TXT record named <code>{dnsRecord}</code> with this value to your publication domain{newsletterUrl ? ` (${new URL(newsletterUrl).hostname})` : ""}.</>;
}

export function PlatformVerificationPanel({ newsletterName, sourcePlatform, newsletterUrl }: PlatformVerificationPanelProps) {
  const [code, setCode] = useState<string>();
  const [dnsRecord, setDnsRecord] = useState<string>();
  const [manualReview, setManualReview] = useState(false);
  const [enteredCode, setEnteredCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function start() {
    setBusy(true); setError(undefined);
    try {
      const response = await fetch("/api/claims/platform/start", { method: "POST", cache: "no-store" });
      const result = await response.json() as { status?: string; code?: string; dnsRecord?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "PLATFORM_VERIFICATION_UNAVAILABLE");
      if (result.status === "manual_review_required") { setManualReview(true); return; }
      setCode(result.code); setDnsRecord(result.dnsRecord ?? undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "PLATFORM_VERIFICATION_UNAVAILABLE"); }
    finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setError(undefined);
    try {
      const response = await fetch("/api/claims/platform/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: enteredCode }) });
      const result = await response.json() as { status?: string; confirmation?: { profile_slug?: string }; error?: string };
      if (!response.ok || result.status !== "confirmed" || !result.confirmation?.profile_slug) throw new Error(result.error ?? "PLATFORM_VERIFICATION_FAILED");
      window.location.assign(`/confirmation?status=confirmed&slug=${encodeURIComponent(result.confirmation.profile_slug)}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "PLATFORM_VERIFICATION_FAILED"); }
    finally { setBusy(false); }
  }

  if (manualReview) return <div className="platform-verification-panel" role="status"><p className="hero-label">MANUAL REVIEW REQUIRED</p><h2>We need to review this publication.</h2><p>Email ownership is confirmed, but Letterboard does not have a supported public ownership check for {readablePlatform(sourcePlatform)}. Your claim remains pending and no Founding Mark has been assigned.</p></div>;

  return <div className="platform-verification-panel" aria-live="polite"><p className="hero-label">SECOND OWNERSHIP CHECK</p><h1>Prove you control this publication.</h1><p>Email confirmation proves control of the inbox only. To activate {newsletterName}, prove control of the {readablePlatform(sourcePlatform)} as well.</p>{!code ? <><p>We will give you a short-lived one-time code. Place it in a public location you control, then return here to verify it.</p><button className="primary-button" type="button" onClick={start} disabled={busy}>{busy ? "Preparing code…" : "Prepare ownership code"} <span>→</span></button></> : <><div className="platform-code"><span>Your one-time code</span><strong>{code}</strong></div><p>{placementCopy(sourcePlatform, dnsRecord, newsletterUrl)}</p><label htmlFor="platform-verification-code">Code after publishing</label><input id="platform-verification-code" value={enteredCode} onChange={(event) => setEnteredCode(event.target.value)} placeholder="LB-123456" autoComplete="off" /><button className="primary-button" type="button" onClick={verify} disabled={busy || !enteredCode.trim()}>{busy ? "Checking publication…" : "Verify publication ownership"} <span>→</span></button></>}{error ? <p className="form-note" role="alert">{error}</p> : null}<p className="form-note">Your Founding Mark stays pending until both checks succeed.</p></div>;
}
