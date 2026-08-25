"use client";

import { useState } from "react";
import { buildSharePlan, type PublicTier, type SharePlan, type SharePlatform, publicProfileUrl } from "@/lib/share";
import { capture } from "@/lib/posthog";

export type ShareProfileButtonProps = {
  slug: string;
  newsletterName: string;
  foundingPosition: number;
  tier: PublicTier;
  sourcePlatform?: string | null;
  newsletterUrl?: string | null;
  label?: string;
};

type CopyPanelState = { plan: SharePlan; text: string } | null;

function openNewTab(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (url.protocol !== "https:") return;
  const anchor = document.createElement("a");
  anchor.href = url.toString();
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.referrerPolicy = "no-referrer";
  anchor.click();
}

export function ShareProfileButton({ slug, newsletterName, foundingPosition, tier, sourcePlatform, newsletterUrl, label = "Share your place →" }: ShareProfileButtonProps) {
  const [toast, setToast] = useState<string>();
  const [copyPanel, setCopyPanel] = useState<CopyPanelState>(null);
  const [chooserOpen, setChooserOpen] = useState(false);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 5000);
  }

  function planForShare(platform?: SharePlatform) {
    const profileUrl = publicProfileUrl(slug);
    if (!profileUrl) throw new Error("INVALID_PROFILE_URL");
    return buildSharePlan({ slug, newsletterName, foundingPosition, tier, sourcePlatform, newsletterUrl, profileUrl }, platform);
  }

  async function copyPlan(plan: SharePlan) {
    const text = plan.copyText ?? plan.message;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(text);
      capture("message_copied", { platform: plan.platform, outcome: "success" });
      capture("share_message_copied", { platform: plan.platform, outcome: "success" });
      capture("share_link_copied", { platform: plan.platform, outcome: "success" });
      return true;
    } catch {
      capture("message_copied", { platform: plan.platform, outcome: "failed" });
      setCopyPanel({ plan, text });
      showToast("Clipboard access was unavailable — copy the message below.");
      return false;
    }
  }

  function startShare() {
    capture("share_started", { outcome: "chooser_opened" });
    capture("share_clicked", { outcome: "chooser_opened" });
    setChooserOpen(true);
  }

  async function selectPlatform(platform: SharePlatform) {
    setChooserOpen(false);
    let plan: SharePlan;
    try {
      plan = planForShare(platform);
    } catch {
      showToast("This share destination is unavailable.");
      return;
    }
    capture("share_platform_selected", { platform: plan.platform, outcome: "selected" });
    capture("share_intent_clicked", { platform: plan.platform, outcome: "clicked" });

    if (plan.platform === "share") {
      if (navigator.share) {
        try {
          await navigator.share({ title: newsletterName, text: plan.message, url: publicProfileUrl(slug) ?? undefined });
          capture("share_composer_opened", { platform: plan.platform, outcome: "opened" });
          showToast(plan.toast);
          return;
        } catch { /* a dismissed sheet is not a posted share */ }
      }
      const copied = await copyPlan(plan);
      if (copied) showToast("Your share message is copied.");
      return;
    }

    if (plan.platform === "x") {
      if (plan.destination) {
        openNewTab(plan.destination);
        capture("composer_opened", { platform: plan.platform, outcome: "opened" });
        capture("share_composer_opened", { platform: plan.platform, outcome: "opened" });
      }
      showToast(plan.toast);
      return;
    }

    const copied = await copyPlan(plan);
    if (!copied) return;
    if (plan.destination) {
      openNewTab(plan.destination);
      capture("composer_opened", { platform: plan.platform, outcome: "opened" });
      capture("share_composer_opened", { platform: plan.platform, outcome: "opened" });
    }
    if (plan.fallback) capture("fallback_used", { platform: plan.platform, outcome: plan.destination ? "publication_opened" : "message_copied" });
    showToast(plan.toast);
  }

  async function retryCopy() {
    if (!copyPanel) return;
    const plan = copyPanel.plan;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(copyPanel.text);
      capture("message_copied", { platform: plan.platform, outcome: "success", retry: true });
      capture("share_message_copied", { platform: plan.platform, outcome: "success", retry: true });
      capture("share_link_copied", { platform: plan.platform, outcome: "success", retry: true });
      setCopyPanel(null);
      if (plan.destination) {
        openNewTab(plan.destination);
        capture("composer_opened", { platform: plan.platform, outcome: "opened", retry: true });
        capture("share_composer_opened", { platform: plan.platform, outcome: "opened", retry: true });
      }
      if (plan.fallback) capture("fallback_used", { platform: plan.platform, outcome: plan.destination ? "publication_opened" : "message_copied" });
      showToast(plan.toast);
    } catch {
      setCopyPanel({ plan, text: copyPanel.text });
      showToast("Clipboard access is still unavailable — use the Copy button below.");
    }
  }

  return <>
    <button className="secondary-button share-profile-button" type="button" onClick={startShare}>{label}</button>
    {chooserOpen ? <div className="share-chooser" role="dialog" aria-modal="true" aria-labelledby={`share-chooser-title-${slug}`}><div className="share-chooser__header"><div><p className="hero-label">LETTERBOARD SHARE</p><h2 id={`share-chooser-title-${slug}`}>Choose where to share</h2></div><button className="icon-button" type="button" onClick={() => setChooserOpen(false)} aria-label="Close share chooser">×</button></div><p>Select a destination. Letterboard prepares the message but never posts for you.</p><div className="share-chooser__options"><button type="button" onClick={() => void selectPlatform("substack")}>Substack Notes</button><button type="button" onClick={() => void selectPlatform("x")}>X</button><button type="button" onClick={() => void selectPlatform("linkedin")}>LinkedIn</button><button type="button" onClick={() => void selectPlatform("medium")}>Medium</button><button type="button" onClick={() => void selectPlatform("copy")}>Copy link</button><button type="button" onClick={() => void selectPlatform("share")}>More / share sheet</button></div></div> : null}
    {toast ? <div className="share-toast" role="status" aria-live="polite">{toast}</div> : null}
    {copyPanel ? <div className="share-copy-panel" role="dialog" aria-modal="false" aria-labelledby={`share-copy-title-${slug}`}>
      <div className="share-copy-panel__header"><div><p className="hero-label">LETTERBOARD SHARE</p><h2 id={`share-copy-title-${slug}`}>Your message is ready.</h2></div><button className="icon-button" type="button" onClick={() => setCopyPanel(null)} aria-label="Close copy panel">×</button></div>
      <p>Clipboard access was unavailable. Copy the complete message below, then paste it into the platform composer.</p>
      <textarea className="share-copy-panel__message" value={copyPanel.text} readOnly aria-label="Share message" />
      <div className="share-copy-panel__actions"><button className="primary-button" type="button" onClick={retryCopy}>Copy message</button><button className="secondary-button" type="button" onClick={() => setCopyPanel(null)}>Close</button></div>
    </div> : null}
  </>;
}
