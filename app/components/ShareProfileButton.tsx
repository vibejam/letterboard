"use client";

import { useState } from "react";
import { buildSharePlan, type PublicTier, type SharePlan, publicProfileUrl } from "@/lib/share";
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

type CopyPanelState = { plan: SharePlan } | null;

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

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 5000);
  }

  function planForShare() {
    const profileUrl = publicProfileUrl(slug);
    if (!profileUrl) throw new Error("INVALID_PROFILE_URL");
    return buildSharePlan({ slug, newsletterName, foundingPosition, tier, sourcePlatform, newsletterUrl, profileUrl });
  }

  async function copyPlan(plan: SharePlan) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(plan.message);
      capture("message_copied", { platform: plan.platform, outcome: "success" });
      capture("share_message_copied", { platform: plan.platform, outcome: "success" });
      return true;
    } catch {
      capture("message_copied", { platform: plan.platform, outcome: "failed" });
      setCopyPanel({ plan });
      showToast("Clipboard access was unavailable — copy the message below.");
      return false;
    }
  }

  async function share() {
    let plan: SharePlan;
    try {
      plan = planForShare();
    } catch {
      showToast("This share destination is unavailable.");
      return;
    }
    capture("share_clicked", { platform: plan.platform, outcome: "clicked" });
    capture("share_intent_clicked", { platform: plan.platform, outcome: "clicked" });

    if (plan.platform === "x") {
      if (plan.destination) {
        openNewTab(plan.destination);
        capture("composer_opened", { platform: plan.platform, outcome: "opened" });
      }
      showToast(plan.toast);
      return;
    }

    const copied = await copyPlan(plan);
    if (!copied) return;
    if (plan.destination) {
      openNewTab(plan.destination);
      capture("composer_opened", { platform: plan.platform, outcome: "opened" });
    }
    if (plan.fallback) capture("fallback_used", { platform: plan.platform, outcome: plan.destination ? "publication_opened" : "message_copied" });
    showToast(plan.toast);
  }

  async function retryCopy() {
    if (!copyPanel) return;
    const plan = copyPanel.plan;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(plan.message);
      capture("message_copied", { platform: plan.platform, outcome: "success", retry: true });
      capture("share_message_copied", { platform: plan.platform, outcome: "success", retry: true });
      setCopyPanel(null);
      if (plan.destination) {
        openNewTab(plan.destination);
        capture("composer_opened", { platform: plan.platform, outcome: "opened", retry: true });
      }
      if (plan.fallback) capture("fallback_used", { platform: plan.platform, outcome: plan.destination ? "publication_opened" : "message_copied" });
      showToast(plan.toast);
    } catch {
      setCopyPanel({ plan });
      showToast("Clipboard access is still unavailable — use the Copy button below.");
    }
  }

  return <>
    <button className="secondary-button share-profile-button" type="button" onClick={share}>{label}</button>
    {toast ? <div className="share-toast" role="status" aria-live="polite">{toast}</div> : null}
    {copyPanel ? <div className="share-copy-panel" role="dialog" aria-modal="false" aria-labelledby={`share-copy-title-${slug}`}>
      <div className="share-copy-panel__header"><div><p className="hero-label">LETTERBOARD SHARE</p><h2 id={`share-copy-title-${slug}`}>Your message is ready.</h2></div><button className="icon-button" type="button" onClick={() => setCopyPanel(null)} aria-label="Close copy panel">×</button></div>
      <p>Clipboard access was unavailable. Copy the complete message below, then paste it into the platform composer.</p>
      <textarea className="share-copy-panel__message" value={copyPanel.plan.message} readOnly aria-label="Share message" />
      <div className="share-copy-panel__actions"><button className="primary-button" type="button" onClick={retryCopy}>Copy message</button><button className="secondary-button" type="button" onClick={() => setCopyPanel(null)}>Close</button></div>
    </div> : null}
  </>;
}
