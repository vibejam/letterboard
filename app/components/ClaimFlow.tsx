"use client";

import { useEffect, useRef, useState } from "react";
import { boardStats, type Newsletter, type NewsletterStatus } from "../data/mock";
import { Boardmark, type BoardmarkTier } from "./Boardmark";
import { NewsletterLogo } from "./Brand";
import { ShareCard } from "./ShareCard";
import { ShareProfileButton } from "./ShareProfileButton";
import { capture } from "@/lib/posthog";

type ClaimFlowProps = { open: boolean; onClose: () => void; initialNewsletter?: Newsletter; liveNewsletter?: Newsletter; onClaimCreated?: (newsletter: Newsletter) => void; boardStatsOverride?: { claimed: number; total: number } };
type Step = "url" | "preview" | "ownership" | "success" | "profile";
type EmailStatus = "idle" | "sending" | "sent" | "failed";
type ApiResult = {
  error?: string;
  newsletter?: { normalizedUrl: string; title: string; canonicalUrl: string; description?: string | null; logoUrl?: string | null; logoSource?: string | null; sourcePlatform?: string | null };
  claim?: { id: string; status: "pending"; emailStatus: "sent" | "failed"; maskedRecipient?: string; profileSlug?: string };
  foundingTier?: BoardmarkTier;
};

const demoNewsletter: Newsletter = { id: "new-newsletter", name: "The Daily Signal", url: "thedailysignal.co", description: "A sharp daily briefing for people building what comes next.", category: "Technology", bid: 0, clicks: 0, lastSeen: "just now", initials: "T", tone: "ink", status: "pending" };
function stepLabel(step: Step, status: NewsletterStatus) {
  if (step === "url") return "01 / ADD URL";
  if (step === "preview") return "02 / REVIEW DETAILS";
  if (step === "ownership") return "03 / CONFIRM OWNERSHIP";
  if (step === "success" && status === "pending") return "04 / PENDING CONFIRMATION";
  return "04 / YOU ARE ON THE BOARD";
}
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= 320; }
function readableError(code?: string) {
  if (code === "EMAIL_REQUIRED") return "Enter a private creator email to receive the ownership confirmation.";
  if (code === "INVALID_EMAIL") return "Enter a valid creator email address.";
  if (code === "RESEND_CONFIG_MISSING") return "Confirmation email is not configured in production. Your profile remains pending; please contact Letterboard support.";
  if (code === "APP_URL_NOT_CONFIGURED") return "Confirmation links are temporarily unavailable. Please try again later.";
  if (code === "RESEND_REQUEST_REJECTED") return "Resend rejected the confirmation email. Your profile remains pending; try sending again.";
  if (code === "CLAIM_NOT_RESENDABLE") return "Your pending claim needs a new confirmation link. Contact support.";
  if (code === "DUPLICATE_NEWSLETTER" || code === "PUBLICATION_ALREADY_CLAIMED") return "This publication already has a Founding 100 place on Letterboard.";
  if (code === "CREATOR_ALREADY_CLAIMED") return "One creator may hold only one Founding 100 place.";
  if (code === "CREATOR_BANNED") return "This creator identity cannot claim or confirm a Founding 100 place.";
  if (code === "CLAIM_NOT_ELIGIBLE") return "This claim is no longer eligible for Founding 100 confirmation.";
  return code ?? "We could not complete the claim. Please try again.";
}

export function ClaimFlow({ open, onClose, initialNewsletter, liveNewsletter, onClaimCreated, boardStatsOverride }: ClaimFlowProps) {
  const [step, setStep] = useState<Step>(initialNewsletter ? "profile" : "url");
  const [value, setValue] = useState(initialNewsletter?.url ?? "");
  const [newsletter, setNewsletter] = useState<Newsletter>(initialNewsletter ?? demoNewsletter);
  const [status, setStatus] = useState<NewsletterStatus>(initialNewsletter?.status ?? "pending");
  const [foundingTier, setFoundingTier] = useState<BoardmarkTier | undefined>(initialNewsletter?.foundingTier);
  const [creatorEmail, setCreatorEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<EmailStatus>("idle");
  const [claimId, setClaimId] = useState<string>();
  const [maskedRecipient, setMaskedRecipient] = useState<string>();
  const [error, setError] = useState<string>();
  const [transitioning, setTransitioning] = useState(false);
  const previewedProfile = useRef(false);
  const boardCount = boardStatsOverride ?? boardStats;
  useEffect(() => {
    if (liveNewsletter?.status !== "confirmed" || previewedProfile.current || step === "profile") return;
    const timer = window.setTimeout(() => {
      if (previewedProfile.current) return;
      setNewsletter(liveNewsletter);
      setStatus("confirmed");
      setFoundingTier(liveNewsletter.foundingTier);
      setStep("success");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [liveNewsletter, step]);
  if (!open) return null;

  async function handleUrlSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    capture("url_submitted");
    setError(undefined);
    try {
      const response = await fetch("/api/newsletters/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: value }) });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.newsletter) throw new Error(result.error ?? "METADATA_UNAVAILABLE");
      capture("metadata_loaded");
      const item = result.newsletter;
      setNewsletter({ ...demoNewsletter, id: item.normalizedUrl, name: item.title, url: item.canonicalUrl, description: item.description ?? "A public newsletter on Letterboard.", logoUrl: item.logoUrl ?? undefined, initials: item.title.slice(0, 1).toUpperCase(), status: "pending", sourcePlatform: item.sourcePlatform });
      setStatus("pending");
      setEmailStatus("idle");
      setError(undefined);
      setStep("preview");
    } catch (caught) {
      capture("metadata_failed");
      capture("claim_flow_error");
      setError(readableError(caught instanceof Error ? caught.message : "METADATA_UNAVAILABLE"));
    }
  }

  async function createClaim() {
    if (!validEmail(creatorEmail)) {
      setError(creatorEmail.trim() ? readableError("INVALID_EMAIL") : readableError("EMAIL_REQUIRED"));
      return;
    }
    setError(undefined);
    setEmailStatus("sending");
    setStep("ownership");
    try {
      const parsed = new URL(newsletter.url.startsWith("http") ? newsletter.url : `https://${newsletter.url}`);
      const normalizedUrl = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "") || "/"}`;
      const response = await fetch("/api/claims", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newsletter: { canonicalUrl: parsed.toString(), normalizedUrl, title: newsletter.name, description: newsletter.description, logoUrl: newsletter.logoUrl, sourcePlatform: newsletter.category }, submittedUrl: value, creatorEmail: creatorEmail.trim() }) });
      const result = await response.json() as ApiResult;
      if (result.claim) {
        setClaimId(result.claim.id);
        setMaskedRecipient(result.claim.maskedRecipient);
        setNewsletter((current) => ({ ...current, slug: result.claim?.profileSlug }));
        onClaimCreated?.({ ...newsletter, slug: result.claim.profileSlug, status: "pending" });
      }
      if (!response.ok || !result.claim || result.claim.emailStatus !== "sent") {
        const code = result.error ?? "EMAIL_SEND_FAILED";
        setEmailStatus("failed");
        setError(readableError(code));
        capture("claim_flow_error", { error: code });
        return;
      }
      setEmailStatus("sent");
      capture("claim_created");
      capture("ownership_email_sent");
    } catch (caught) {
      setEmailStatus("failed");
      setError(readableError(caught instanceof Error ? caught.message : "EMAIL_SEND_FAILED"));
      capture("claim_flow_error");
    }
  }

  async function resendConfirmation() {
    if (!claimId) {
      setEmailStatus("failed");
      setError(readableError("CLAIM_NOT_RESENDABLE"));
      return;
    }
    if (!validEmail(creatorEmail)) { setError(readableError("INVALID_EMAIL")); return; }
    setError(undefined);
    setEmailStatus("sending");
    try {
      const response = await fetch("/api/claims/resend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimId, creatorEmail: creatorEmail.trim() }) });
      const result = await response.json() as ApiResult;
      if (result.claim) setMaskedRecipient(result.claim.maskedRecipient);
      if (!response.ok || !result.claim || result.claim.emailStatus !== "sent") {
        setEmailStatus("failed");
        setError(readableError(result.error ?? "EMAIL_SEND_FAILED"));
        return;
      }
      setEmailStatus("sent");
      capture("ownership_email_sent");
    } catch (caught) {
      setEmailStatus("failed");
      setError(readableError(caught instanceof Error ? caught.message : "EMAIL_SEND_FAILED"));
    }
  }

  function keepPending() { setStatus("pending"); setStep("success"); }
  function previewProfile() { previewedProfile.current = true; setStep("profile"); setTransitioning(false); }
  function closeProfile() { previewedProfile.current = true; setTransitioning(true); onClose(); }
  const shareSlug = newsletter.slug;
  const sharePosition = newsletter.foundingPosition ?? boardCount.claimed + 1;
  const shareTier = foundingTier ?? "og";
  const shareProps = shareSlug ? { slug: shareSlug, newsletterName: newsletter.name, foundingPosition: sharePosition, tier: shareTier, sourcePlatform: newsletter.sourcePlatform, newsletterUrl: newsletter.url } : null;

  const emailTitle = emailStatus === "sending" ? "Sending confirmation email" : emailStatus === "sent" ? "Confirmation email sent" : emailStatus === "failed" ? "Email could not be sent" : "Confirmation email required";
  const emailDetail = emailStatus === "sent" ? `Sent to ${maskedRecipient ?? "your private creator email"}` : emailStatus === "failed" ? "Your profile remains pending until ownership is confirmed." : emailStatus === "sending" ? "Please wait while Letterboard contacts you." : "Enter your private creator email in the previous step.";

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="claim-modal" role="dialog" aria-modal="true" aria-labelledby="claim-title">
    <header className="claim-modal__header"><div><p className="eyebrow">{stepLabel(step, status)}</p><h2 id="claim-title">{step === "success" ? status === "confirmed" ? "You are on the board." : "Your profile is pending." : step === "profile" ? "Public profile preview" : "Claim your Founding 100 place."}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close claim flow">×</button></header>
    <div className="progress-dots" aria-label={`Step ${stepLabel(step, status)}`}>{["url", "preview", "ownership", "success"].map((item, index) => <span key={item} className={`progress-dot ${["url", "preview", "ownership", "success"].indexOf(step) >= index ? "progress-dot--active" : ""}`} />)}</div>
    {step === "url" && <div className="claim-step claim-step--url"><div className="claim-step__copy"><p className="hero-label">FOUNDING 100 / FREE CLAIM</p><h3>Put your newsletter on the board.</h3><p>Share a URL. We will pull the public details into a profile for you. No payment, no exclusivity, no commitment.</p></div><form onSubmit={handleUrlSubmit} className="url-form"><label htmlFor="newsletter-url">Newsletter URL</label><div className="url-input-wrap"><span>↗</span><input id="newsletter-url" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Paste your newsletter URL" autoFocus /><button type="submit">Find my newsletter <span>→</span></button></div><p className="form-note">Try <button type="button" onClick={() => setValue("thedailysignal.co")}>thedailysignal.co</button> to preview the flow.</p></form><div className="reassurance-row"><span className="reassurance-icon">✓</span><span>We only use public information. Your profile stays pending until ownership is confirmed.</span></div>{error && <p className="form-note" role="alert">{error}</p>}</div>}
    {step === "preview" && <div className="claim-step"><div className="split-step"><div><p className="hero-label">DETAILS AUTO-FILLED</p><h3>We found your newsletter.</h3><p>Check the public details below. You can update them later from your creator profile.</p><div className="auto-fill-note"><span className="auto-fill-check">✓</span><span><strong>Newsletter found</strong><br />The URL resolves and public metadata is ready.</span></div><div className="creator-email-field"><label htmlFor="creator-email">Creator email for one-click ownership confirmation</label><input id="creator-email" type="email" value={creatorEmail} onChange={(event) => setCreatorEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required /><p>This email is used only to confirm ownership. It will not appear on your public profile.</p></div><button className="primary-button" onClick={createClaim}>Send confirmation email <span>→</span></button><button className="secondary-button" onClick={() => setStep("url")}>Use a different URL</button>{error && <p className="form-note" role="alert">{error}</p>}</div><div className="preview-panel"><span className="preview-panel__label">PUBLIC PROFILE PREVIEW</span><div className="profile-heading"><NewsletterLogo src={newsletter.logoUrl} alt={`${newsletter.name} logo`} initials={newsletter.initials} tone={newsletter.tone} /><div><h4>{newsletter.name}</h4><p>{newsletter.category}</p></div></div><Boardmark status="pending" /><div className="preview-divider" /><p>{newsletter.description}</p><span className="preview-url">{newsletter.url}</span></div></div><div className="reassurance-row"><span className="reassurance-icon">◎</span><span>This creates a free pending profile. The Founding Mark activates after one-click ownership confirmation.</span></div></div>}
    {step === "ownership" && <div className="claim-step"><div className="ownership-layout"><div className="ownership-icon">✉</div><div><p className="hero-label">ONE-CLICK CONFIRMATION</p><h3>{emailStatus === "sent" ? "Check your inbox." : emailStatus === "failed" ? "Your profile is still pending." : "Confirm your email, then prove you control this publication."}</h3><p>{emailStatus === "sent" ? "Email confirmation proves control of the inbox only. After clicking the link, Letterboard will ask you to prove control of the publication too." : "Your private creator email is used only for ownership confirmation. It will not appear on your public profile."}</p><div className={`email-preview email-preview--${emailStatus}`}><span className="email-preview__dot" /><div><strong>{emailTitle}</strong><span>{emailDetail}</span></div><span className="email-preview__status">{emailStatus === "sending" ? "SENDING" : emailStatus === "sent" ? "SENT" : emailStatus === "failed" ? "FAILED" : "REQUIRED"}</span></div>{error && <p className="form-note" role="alert">{error}</p>}<div className="button-stack">{emailStatus === "failed" && <button className="primary-button" onClick={resendConfirmation}>Send again <span>→</span></button>}{emailStatus !== "sending" && <button className="secondary-button" onClick={keepPending}>Keep profile pending</button>}</div></div></div></div>}
    {step === "success" && <div className="claim-step success-step"><div className="success-hero"><span className="success-check">✓</span><p className="hero-label">{status === "confirmed" ? "FOUNDING STATUS CONFIRMED" : "PENDING CONFIRMATION"}</p><h3>{status === "confirmed" ? "Your Founding Mark is live." : "Your place is reserved."}</h3><p>{status === "confirmed" ? "You are confirmed on Letterboard and your public profile is ready to share." : "Your pending profile is reserved. Confirm email ownership, then prove you control the publication to activate your Founding Mark."}</p><Boardmark status={status} tier={foundingTier} size="large" /></div><div className="success-position"><span className="success-position__rank">#{String(sharePosition).padStart(2, "0")}</span><div><strong>{newsletter.name}</strong><span>Founding place / 100</span></div><span className="success-position__status">{status === "confirmed" ? "ACTIVE" : "PENDING"}</span></div><div className="success-actions">{shareProps ? <ShareProfileButton {...shareProps} /> : null}<button className="secondary-button" onClick={previewProfile} disabled={transitioning}>Preview public profile <span>→</span></button></div><p className="optional-note">Sharing is optional. It helps the board become visible; it does not gate your place.</p></div>}
    {step === "profile" && <div className="claim-step profile-step"><div className="profile-preview-header"><div><p className="hero-label">PUBLIC PROFILE</p><h3>{newsletter.name}</h3><p>{newsletter.url}</p></div><Boardmark status={status} tier={foundingTier} /></div><div className="profile-preview-card"><div className="profile-preview-card__main"><NewsletterLogo src={newsletter.logoUrl} alt={`${newsletter.name} logo`} initials={newsletter.initials} tone={newsletter.tone} /><div><span className="profile-preview-card__category">{newsletter.category}</span><h4>{newsletter.name}</h4><p>{newsletter.description}</p></div></div><div className="profile-preview-card__meta"><span><strong>#{String(sharePosition).padStart(2, "0")}</strong><small>Founding place</small></span><span><strong>{status === "confirmed" ? "Ready" : "Pending"}</strong><small>Founding Mark</small></span></div></div><div className="profile-share-preview"><div><p className="hero-label">SHARE CARD</p><h4>Make your place visible.</h4><p>Use the same profile details and Founding Mark everywhere you share it.</p></div><ShareCard name={newsletter.name} url={newsletter.url} category={newsletter.category} description={newsletter.description} rank={sharePosition} status={status} tier={foundingTier} initials={newsletter.initials} tone={newsletter.tone} logoUrl={newsletter.logoUrl} share={shareProps ?? undefined} /></div><div className="success-actions">{shareProps ? <ShareProfileButton {...shareProps} label="Share your place →" /> : null}<button className="secondary-button" onClick={closeProfile} disabled={transitioning}>Done</button></div></div>}
  </section></div>;
}
