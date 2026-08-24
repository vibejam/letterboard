import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createOpaqueToken, maskEmail, normalizeCreatorEmail, sendOwnershipEmail } from "../lib/ownership.ts";

const claimsRoute = await readFile(new URL("../app/api/claims/route.ts", import.meta.url), "utf8");
const confirmRoute = await readFile(new URL("../app/api/claims/confirm/route.ts", import.meta.url), "utf8");
const resendRoute = await readFile(new URL("../app/api/claims/resend/route.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260823120000_ownership_confirmation_transaction.sql", import.meta.url), "utf8");

test("creator email is required, validated, and masked", () => {
  assert.equal(normalizeCreatorEmail(undefined), null);
  assert.equal(normalizeCreatorEmail("not-an-email"), null);
  assert.equal(normalizeCreatorEmail(" Creator@Example.COM "), "creator@example.com");
  assert.equal(maskEmail("creator@example.com"), "c•••@example.com");
});

test("verification token is opaque and persisted only as a hash", () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.notEqual(first.rawToken, first.tokenHash);
  assert.notEqual(first.rawToken, second.rawToken);
  assert.equal(first.tokenHash.length, 64);
  assert.match(claimsRoute, /token_hash: tokenHash/);
  assert.doesNotMatch(claimsRoute, /confirmationUrl/);
  assert.match(migration, /used_at is null/);
  assert.match(migration, /expires_at > now\(\)/);
});

test("successful Resend response requires a message id", async () => {
  const previousFetch = globalThis.fetch;
  const previous = { key: process.env.RESEND_API_KEY, from: process.env.OWNERSHIP_EMAIL_FROM, appUrl: process.env.NEXT_PUBLIC_APP_URL };
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.OWNERSHIP_EMAIL_FROM = "Seth <seth@letterboard.lol>";
  process.env.NEXT_PUBLIC_APP_URL = "https://www.letterboard.lol";
  let payload;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "msg_test_123" }), { status: 200 });
  };
  const result = await sendOwnershipEmail({ requestId: "request-test", claimId: "claim-test", recipient: "creator@example.com", newsletterTitle: "A Newsletter", rawToken: "opaque-token" });
  assert.deepEqual(result, { ok: true, messageId: "msg_test_123" });
  const confirmationUrl = new URL(payload.text.split("\n")[3]);
  assert.deepEqual([...confirmationUrl.searchParams.keys()], ["token"]);
  assert.equal(payload.subject, "Confirm your Letterboard profile");
  assert.match(payload.text, /This email is sent by Letterboard for ownership confirmation\. It is not marketing\./);
  globalThis.fetch = previousFetch;
  if (previous.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.key;
  if (previous.from === undefined) delete process.env.OWNERSHIP_EMAIL_FROM; else process.env.OWNERSHIP_EMAIL_FROM = previous.from;
  if (previous.appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = previous.appUrl;
});

test("Resend failure is not reported as sent", async () => {
  const previousFetch = globalThis.fetch;
  const previous = { key: process.env.RESEND_API_KEY, from: process.env.OWNERSHIP_EMAIL_FROM, appUrl: process.env.NEXT_PUBLIC_APP_URL };
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.OWNERSHIP_EMAIL_FROM = "Seth <seth@letterboard.lol>";
  process.env.NEXT_PUBLIC_APP_URL = "https://www.letterboard.lol";
  globalThis.fetch = async () => new Response(JSON.stringify({ name: "validation_error", message: "from is not a valid email" }), { status: 422 });
  const result = await sendOwnershipEmail({ requestId: "request-test", claimId: "claim-test", recipient: "creator@example.com", newsletterTitle: "A Newsletter", rawToken: "opaque-token" });
  assert.deepEqual(result, { ok: false, reason: "EMAIL_SEND_FAILED", errorCode: "VALIDATION_ERROR", errorMessage: "from is not a valid email" });
  globalThis.fetch = previousFetch;
  if (previous.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.key;
  if (previous.from === undefined) delete process.env.OWNERSHIP_EMAIL_FROM; else process.env.OWNERSHIP_EMAIL_FROM = previous.from;
  if (previous.appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = previous.appUrl;
});

test("routes enforce explicit email, resend rate limiting, and transactional confirmation", () => {
  assert.match(claimsRoute, /EMAIL_REQUIRED/);
  assert.match(claimsRoute, /INVALID_EMAIL/);
  assert.match(claimsRoute, /creatorEmail/);
  assert.match(claimsRoute, /emailStatus: email\.ok \? "sent"/);
  assert.match(claimsRoute, /email\.errorCode \?\? email\.reason/);
  assert.match(claimsRoute, /\.eq\("status", "pending"\)/);
  assert.match(claimsRoute, /claim: \{/);
  assert.match(resendRoute, /resend-confirmation/);
  assert.match(resendRoute, /email\.errorCode \?\? email\.reason/);
  assert.match(resendRoute, /contact_email/);
  assert.match(confirmRoute, /confirm_ownership/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /ownership_status = 'confirmed'/);
  assert.match(migration, /event_type, approved/);
});
