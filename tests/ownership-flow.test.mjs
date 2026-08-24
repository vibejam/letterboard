import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createOpaqueToken, maskEmail, normalizeCreatorEmail, sendOwnershipEmail } from "../lib/ownership.ts";

const claimsRoute = await readFile(new URL("../app/api/claims/route.ts", import.meta.url), "utf8");
const confirmRoute = await readFile(new URL("../app/api/claims/confirm/route.ts", import.meta.url), "utf8");
const resendRoute = await readFile(new URL("../app/api/claims/resend/route.ts", import.meta.url), "utf8");
const ownership = await readFile(new URL("../lib/ownership.ts", import.meta.url), "utf8");
const claimFlow = await readFile(new URL("../app/components/ClaimFlow.tsx", import.meta.url), "utf8");
const repairRoute = await readFile(new URL("../app/api/admin/claims/repair/route.ts", import.meta.url), "utf8");
const boardRoute = await readFile(new URL("../app/api/board/route.ts", import.meta.url), "utf8");
const boardLib = await readFile(new URL("../lib/board.ts", import.meta.url), "utf8");
const profileRoute = await readFile(new URL("../app/api/profiles/[slug]/route.ts", import.meta.url), "utf8");
const homePage = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const homeClient = await readFile(new URL("../app/components/HomeClient.tsx", import.meta.url), "utf8");
const leaderboard = await readFile(new URL("../app/components/Leaderboard.tsx", import.meta.url), "utf8");
const boardmark = await readFile(new URL("../app/components/Boardmark.tsx", import.meta.url), "utf8");
const confirmationPage = await readFile(new URL("../app/confirmation/page.tsx", import.meta.url), "utf8");
const publicProfilePage = await readFile(new URL("../app/[slug]/page.tsx", import.meta.url), "utf8");
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
  assert.deepEqual(result, { ok: false, reason: "RESEND_REQUEST_REJECTED", errorCode: "VALIDATION_ERROR", errorMessage: "from is not a valid email" });
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
  assert.match(claimsRoute, /RESEND_CONFIG_MISSING/);
  assert.match(claimsRoute, /email\.reason/);
  assert.match(claimsRoute, /\.eq\("status", "pending"\)/);
  assert.match(claimsRoute, /claim: \{/);
  assert.match(resendRoute, /resend-confirmation/);
  assert.match(resendRoute, /CLAIM_NOT_RESENDABLE/);
  assert.match(resendRoute, /email\.reason/);
  assert.match(resendRoute, /contact_email/);
  assert.match(claimFlow, /fetch\("\/api\/claims\/resend"/);
  assert.doesNotMatch(claimFlow, /if \(!claimId\) return createClaim/);
  assert.match(confirmRoute, /confirm_ownership/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /ownership_status = 'confirmed'/);
  assert.match(migration, /event_type, approved/);
});

test("resend uses the server-side Resend SDK and safe provider diagnostics", () => {
  assert.match(ownership, /resend\.emails\.send/);
  assert.match(ownership, /from,\s*to: \[recipient\]/s);
  assert.match(ownership, /providerCalled/);
  assert.match(ownership, /senderDomain/);
  assert.doesNotMatch(ownership, /api\.resend\.com\/emails/);
});

test("admin repair is restricted, non-duplicating, and preserves founding authority", () => {
  assert.match(repairRoute, /ADMIN_REVIEW_TOKEN/);
  assert.match(repairRoute, /authorization/);
  assert.match(repairRoute, /claimId/);
  assert.match(repairRoute, /creatorEmail/);
  assert.match(repairRoute, /claim\.status !== "pending"/);
  assert.match(repairRoute, /newsletter\.ownership_status !== "pending"/);
  assert.match(repairRoute, /newsletter\.boardmark_status !== "pending"/);
  assert.match(repairRoute, /contact_email/);
  assert.doesNotMatch(repairRoute, /CLAIM_EMAIL_MISSING/);
  assert.match(repairRoute, /CLAIM_EMAIL_MISMATCH/);
  assert.match(repairRoute, /used_at: new Date\(\)\.toISOString\(\)/);
  assert.match(repairRoute, /token_hash: tokenHash/);
  assert.match(repairRoute, /expires_at: new Date/);
  assert.match(repairRoute, /sendOwnershipEmail/);
  assert.match(repairRoute, /messageId: email\.messageId/);
  assert.match(repairRoute, /admin_audit_log/);
  assert.match(repairRoute, /senderDomain/);
  assert.doesNotMatch(repairRoute, /from\("claims"\)\.insert/);
  assert.doesNotMatch(repairRoute, /internal_points/);
});

test("admin repair keeps confirmed and rejected claims out of the resend path", () => {
  assert.match(repairRoute, /CLAIM_NOT_RESENDABLE/);
  assert.match(repairRoute, /status !== "pending"/);
  assert.match(repairRoute, /ownership_status !== "pending"/);
});

test("confirmation redirects to branded UI and removes the token from the visible URL", () => {
  assert.match(confirmRoute, /confirmationRedirect/);
  assert.match(confirmRoute, /status: "confirmed"/);
  assert.match(confirmRoute, /NextResponse\.redirect/);
  assert.doesNotMatch(confirmRoute, /NextResponse\.json/);
  assert.match(confirmationPage, /Your Founding Mark is active\./);
  assert.match(confirmationPage, /FOUNDING STATUS CONFIRMED/);
  assert.match(confirmationPage, /View my public profile/);
  assert.match(confirmationPage, /Return to the board/);
  assert.match(confirmationPage, /This confirmation link is no longer valid/);
  assert.match(confirmationPage, /ALREADY_CONFIRMED/);
  assert.match(confirmRoute, /MISSING_TOKEN/);
  assert.match(confirmRoute, /claim_id,expires_at,used_at/);
  assert.doesNotMatch(confirmationPage, /searchParams\.get\("token"\)|internal_points|contact_email/);
});

test("homepage presents Founding Mark onboarding copy and truthful empty states", () => {
  assert.match(homeClient, /Be one of the first 100 newsletters on Letterboard\./);
  assert.match(homeClient, /Claim a free public profile, secure your founding place, and carry your Founding Mark/);
  assert.match(homeClient, /Free to claim\. No card\. No pay-to-enter\./);
  assert.match(homeClient, /Paste your newsletter URL/);
  assert.match(homeClient, /Claim my place/);
  assert.match(homeClient, /OG 01–05 · LEGEND 06–10 · ICON 11–50 · PIONEER 51–100/);
  assert.match(homeClient, /Founding places claimed/);
  assert.match(homeClient, /Spotlight opens after the Founding 100 closes/);
  assert.doesNotMatch(homeClient, /visitors|online now|fake activity/i);
  assert.match(leaderboard, /Who gets there first\?/);
  assert.match(leaderboard, /Letterboard starts here\./);
  assert.match(leaderboard, /The first verified newsletter takes #01 — and becomes the first OG\./);
  assert.match(leaderboard, /Nothing moving yet\. You could start the first signal\./);
  assert.match(leaderboard, /No activity yet\. The board is waiting on its first confirmation\./);
  assert.match(boardmark, /Founding Mark/);
});

test("confirmed profiles flow from the transaction into the live board and public page", () => {
  assert.match(migration, /insert into public\.public_profiles[\s\S]*is_published\)[\s\S]*true/);
  assert.match(boardRoute, /force-dynamic/);
  assert.match(boardLib, /ownership_status.*confirmed/);
  assert.match(boardRoute, /Cache-Control.*no-store/);
  assert.match(profileRoute, /force-dynamic/);
  assert.match(profileRoute, /ownership_status.*confirmed/);
  assert.match(homePage, /force-dynamic/);
  assert.match(homePage, /getBoardPayload/);
  assert.match(homeClient, /fetch\("\/api\/board"/);
  assert.match(homeClient, /mapBoardRow/);
  assert.match(publicProfilePage, /ownership_status.*confirmed/);
  assert.match(publicProfilePage, /public_profiles/);
  assert.match(publicProfilePage, /Boardmark status="confirmed"/);
  assert.doesNotMatch(boardLib, /internal_points|contact_email/);
  assert.doesNotMatch(profileRoute, /internal_points|contact_email/);
  assert.doesNotMatch(publicProfilePage, /internal_points|contact_email/);
});

test("legacy pending claims backfill a missing email without creating a claim", () => {
  assert.match(repairRoute, /let storedContactEmail = claim\.contact_email/);
  assert.match(repairRoute, /update\(\{ contact_email: creatorEmail \}\)/);
  assert.match(repairRoute, /\.eq\("status", "pending"\)\.is\("contact_email", null\)/);
  assert.match(repairRoute, /storedContactEmail = backfilled\.data\.contact_email/);
  assert.match(repairRoute, /sendOwnershipEmail/);
  assert.doesNotMatch(repairRoute, /from\("claims"\)\.insert/);
});

test("legacy repair protects existing emails, reports provider failure, and does not leak tokens", () => {
  assert.match(repairRoute, /claim_email_backfill_failed/);
  assert.match(repairRoute, /claim_email_backfill_conflict/);
  assert.match(repairRoute, /normalizeCreatorEmail\(storedContactEmail\) !== creatorEmail/);
  assert.match(repairRoute, /email\.reason/);
  assert.match(repairRoute, /providerCalled: true/);
  assert.doesNotMatch(repairRoute, /console\.(info|warn|error)\([^\n]*rawToken/);
  assert.doesNotMatch(repairRoute, /console\.(info|warn|error)\([^\n]*(creatorEmail|contact_email)/);
});
