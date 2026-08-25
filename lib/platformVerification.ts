import { createHash, randomInt } from "node:crypto";

export const PLATFORM_SESSION_COOKIE = "letterboard_claim_session";

export function hashVerificationValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createPlatformCode() {
  return `LB-${randomInt(100000, 1000000)}`;
}

export function safeVerificationCode(value: unknown) {
  return typeof value === "string" && /^LB-[0-9]{6}$/i.test(value.trim()) ? value.trim().toUpperCase() : null;
}
