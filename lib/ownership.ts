import { createHash, randomBytes } from "node:crypto";
import { Resend } from "resend";

export type OwnershipEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "RESEND_CONFIG_MISSING" | "APP_URL_NOT_CONFIGURED" | "RESEND_REQUEST_REJECTED"; errorCode?: string; errorMessage?: string };

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
  providerCalled,
  messageId,
  errorCode,
  errorMessage,
}: {
  requestId: string;
  claimId: string;
  recipient?: string;
  from?: string;
  outcome: string;
  providerCalled: boolean;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
}) {
  console.info("ownership email", {
    requestId,
    claimId,
    recipientDomain: domainOf(recipient),
    senderDomain: domainOf(from),
    providerCalled,
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
    logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "config_missing", providerCalled: false, errorCode: "RESEND_CONFIG_MISSING" });
    return { ok: false, reason: "RESEND_CONFIG_MISSING", errorCode: "RESEND_CONFIG_MISSING" };
  }
  if (!appUrl) {
    logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "app_url_missing", providerCalled: false, errorCode: "APP_URL_NOT_CONFIGURED" });
    return { ok: false, reason: "APP_URL_NOT_CONFIGURED", errorCode: "APP_URL_NOT_CONFIGURED" };
  }

  let confirmationUrl: string;
  try {
    const origin = new URL(appUrl);
    if (origin.protocol !== "https:") {
      logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "app_url_invalid", providerCalled: false, errorCode: "APP_URL_NOT_CONFIGURED" });
      return { ok: false, reason: "APP_URL_NOT_CONFIGURED", errorCode: "APP_URL_NOT_CONFIGURED" };
    }
    confirmationUrl = new URL(`/api/claims/confirm?token=${encodeURIComponent(rawToken)}`, origin).toString();
  } catch {
    logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "app_url_invalid", providerCalled: false, errorCode: "APP_URL_NOT_CONFIGURED" });
    return { ok: false, reason: "APP_URL_NOT_CONFIGURED", errorCode: "APP_URL_NOT_CONFIGURED" };
  }

  const title = escapeHtml(newsletterTitle);
  const text = `You requested a free pending profile for ${newsletterTitle} on Letterboard.\n\nConfirm ownership to activate your Founding 100 status:\n${confirmationUrl}\n\nIf you did not request this, you can ignore this email.\n\nThis email is sent by Letterboard for ownership confirmation. It is not marketing.`;
  const html = `<p>You requested a free pending profile for <strong>${title}</strong> on Letterboard.</p><p>Confirm ownership to activate your Founding 100 status:</p><p><a href="${confirmationUrl}">Confirm ownership</a></p><p>If you did not request this, you can ignore this email.</p><p>This email is sent by Letterboard for ownership confirmation. It is not marketing.</p>`;

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: [recipient],
      subject: "Confirm your Letterboard profile",
      text,
      html,
    });
    const messageId = typeof data?.id === "string" ? data.id : null;
    if (!error && messageId) {
      logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "accepted", providerCalled: true, messageId });
      return { ok: true, messageId };
    }
    const errorCode = error ? sanitizeErrorCode(error.name, "RESEND_REQUEST_REJECTED") : "RESEND_MISSING_MESSAGE_ID";
    const errorMessage = sanitizeErrorMessage(error?.message);
    logOwnershipEmail({ requestId, claimId, recipient, from, outcome: error ? "rejected" : "missing_message_id", providerCalled: true, messageId: messageId ?? undefined, errorCode, errorMessage });
    return { ok: false, reason: "RESEND_REQUEST_REJECTED", errorCode, ...(errorMessage ? { errorMessage } : {}) };
  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error instanceof Error ? error.message : undefined);
    logOwnershipEmail({ requestId, claimId, recipient, from, outcome: "request_failed", providerCalled: true, errorCode: "RESEND_REQUEST_REJECTED", errorMessage });
    return { ok: false, reason: "RESEND_REQUEST_REJECTED", errorCode: "RESEND_REQUEST_REJECTED", ...(errorMessage ? { errorMessage } : {}) };
  }
}
