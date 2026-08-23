import { createHash, randomBytes } from "node:crypto";

export type OwnershipEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "EMAIL_NOT_CONFIGURED" | "APP_URL_NOT_CONFIGURED" | "EMAIL_SEND_FAILED" };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeCreatorEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) && email.length <= 320 ? email : null;
}

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•••";
  return `${local.slice(0, 1)}•••@${domain}`;
}

export function createOpaqueToken() {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: createHash("sha256").update(rawToken).digest("hex") };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export async function sendOwnershipEmail({
  requestId,
  claimId,
  recipient,
  newsletterTitle,
  rawToken,
}: {
  requestId: string;
  claimId: string;
  recipient: string;
  newsletterTitle: string;
  rawToken: string;
}): Promise<OwnershipEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.OWNERSHIP_EMAIL_FROM;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!apiKey || !from) return { ok: false, reason: "EMAIL_NOT_CONFIGURED" };
  if (!appUrl) return { ok: false, reason: "APP_URL_NOT_CONFIGURED" };

  let confirmationUrl: string;
  try {
    const origin = new URL(appUrl);
    if (origin.protocol !== "https:") return { ok: false, reason: "APP_URL_NOT_CONFIGURED" };
    confirmationUrl = new URL(`/api/claims/confirm?token=${encodeURIComponent(rawToken)}`, origin).toString();
  } catch {
    return { ok: false, reason: "APP_URL_NOT_CONFIGURED" };
  }

  const title = escapeHtml(newsletterTitle);
  const text = `You requested a free pending profile for ${newsletterTitle} on Letterboard.\n\nConfirm ownership to activate your Founding 100 status:\n${confirmationUrl}\n\nIf you did not request this, you can ignore this email.\n\nThis email is sent by Letterboard for ownership confirmation. It is not marketing.`;
  const html = `<p>You requested a free pending profile for <strong>${title}</strong> on Letterboard.</p><p>Confirm ownership to activate your Founding 100 status:</p><p><a href="${confirmationUrl}">Confirm ownership</a></p><p>If you did not request this, you can ignore this email.</p><p>This email is sent by Letterboard for ownership confirmation. It is not marketing.</p>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [recipient], subject: "Confirm your Letterboard profile", text, html }),
      signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json().catch(() => null) as { id?: unknown } | null;
    const messageId = typeof payload?.id === "string" ? payload.id : null;
    const outcome = response.ok && messageId ? "sent" : "failed";
    console.info("ownership email", { requestId, claimId, recipientDomain: recipient.split("@")[1], outcome, ...(messageId ? { messageId } : {}) });
    return response.ok && messageId ? { ok: true, messageId } : { ok: false, reason: "EMAIL_SEND_FAILED" };
  } catch {
    console.info("ownership email", { requestId, claimId, recipientDomain: recipient.split("@")[1], outcome: "failed" });
    return { ok: false, reason: "EMAIL_SEND_FAILED" };
  }
}
