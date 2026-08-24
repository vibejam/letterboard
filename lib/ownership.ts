import { createHash, randomBytes } from "node:crypto";

export type OwnershipEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "EMAIL_NOT_CONFIGURED" | "APP_URL_NOT_CONFIGURED" | "EMAIL_SEND_FAILED"; errorCode?: string; errorMessage?: string };

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

function domainOf(value: string | undefined) {
  if (!value) return "unknown";
  const address = value.match(/<\s*[^@<>\s]+@([^<>\s]+)\s*>/)?.[1] ?? value.match(/[^@\s]+@([^\s>]+)/)?.[1];
  return address?.toLowerCase() ?? "unknown";
}

function sanitizeErrorCode(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const code = value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64).toUpperCase();
  return code || fallback;
}

function sanitizeErrorMessage(value: unknown) {
  if (typeof value !== "string") return undefined;
  const message = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return message || undefined;
}

function logOwnershipEmail({
  requestId,
  claimId,
  recipient,
  from,
  outcome,
  messageId,
  errorCode,
  errorMessage,
}: {
  requestId: string;
  claimId: string;
  recipient?: string;
  from?: string;
  outcome: string;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
}) {
  console.info("ownership email", {
    requestId,
    claimId,
    recipientDomain: domainOf(recipient),
    senderDomain: domainOf(from),
    outcome,
    ...(messageId ? { messageId } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  });
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
  if (!apiKey || !from) {
    logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "not_configured", errorCode: "EMAIL_NOT_CONFIGURED" });
    return { ok: false, reason: "EMAIL_NOT_CONFIGURED", errorCode: "EMAIL_NOT_CONFIGURED" };
  }
  if (!appUrl) {
    logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "not_configured", errorCode: "APP_URL_NOT_CONFIGURED" });
    return { ok: false, reason: "APP_URL_NOT_CONFIGURED", errorCode: "APP_URL_NOT_CONFIGURED" };
  }

  let confirmationUrl: string;
  try {
    const origin = new URL(appUrl);
    if (origin.protocol !== "https:") {
      logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "not_configured", errorCode: "APP_URL_NOT_CONFIGURED" });
      return { ok: false, reason: "APP_URL_NOT_CONFIGURED", errorCode: "APP_URL_NOT_CONFIGURED" };
    }
    confirmationUrl = new URL(`/api/claims/confirm?token=${encodeURIComponent(rawToken)}`, origin).toString();
  } catch {
    logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "not_configured", errorCode: "APP_URL_NOT_CONFIGURED" });
    return { ok: false, reason: "APP_URL_NOT_CONFIGURED", errorCode: "APP_URL_NOT_CONFIGURED" };
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
    const payload = await response.json().catch(() => null) as { id?: unknown; name?: unknown; message?: unknown; error?: unknown } | null;
    const messageId = typeof payload?.id === "string" ? payload.id : null;
    if (response.ok && messageId) {
      logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "accepted", messageId });
      return { ok: true, messageId };
    }
    const providerError = typeof payload?.error === "object" && payload.error !== null ? payload.error as { name?: unknown; code?: unknown; message?: unknown } : null;
    const errorCode = response.ok ? "RESEND_MISSING_MESSAGE_ID" : sanitizeErrorCode(providerError?.name ?? providerError?.code ?? payload?.name, `RESEND_HTTP_${response.status}`);
    const errorMessage = sanitizeErrorMessage(providerError?.message ?? payload?.message ?? (typeof payload?.error === "string" ? payload.error : undefined));
    logOwnershipEmail({ requestId, claimId, recipient, from, outcome: response.ok ? "missing_message_id" : "rejected", messageId: messageId ?? undefined, errorCode, errorMessage });
    return { ok: false, reason: "EMAIL_SEND_FAILED", errorCode, ...(errorMessage ? { errorMessage } : {}) };
  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error instanceof Error ? error.message : undefined);
    logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "request_failed", errorCode: "RESEND_NETWORK_ERROR", errorMessage });
    return { ok: false, reason: "EMAIL_SEND_FAILED", errorCode: "RESEND_NETWORK_ERROR", ...(errorMessage ? { errorMessage } : {}) };
  }
}
