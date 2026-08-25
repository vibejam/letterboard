import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createOpaqueToken, creatorIdentityHash, maskEmail, normalizeCreatorEmail, sendOwnershipEmail } from "../lib/ownership.ts";
import { extractLogoCandidates, resolvePublicMetadata } from "../lib/metadata.ts";
import { normalizeNewsletterUrl, safeExternalUrl } from "../lib/urls.ts";

const claimsRoute = await readFile(new URL("../app/api/claims/route.ts", import.meta.url), "utf8");
const confirmRoute = await readFile(new URL("../app/api/claims/confirm/route.ts", import.meta.url), "utf8");
const resendRoute = await readFile(new URL("../app/api/claims/resend/route.ts", import.meta.url), "utf8");
const ownership = await readFile(new URL("../lib/ownership.ts", import.meta.url), "utf8");
const claimFlow = await readFile(new URL("../app/components/ClaimFlow.tsx", import.meta.url), "utf8");
const repairRoute = await readFile(new URL("../app/api/admin/claims/repair/route.ts", import.meta.url), "utf8");
const banRoute = await readFile(new URL("../app/api/admin/creators/ban/route.ts", import.meta.url), "utf8");
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
const hardeningMigration = await readFile(new URL("../supabase/migrations/20260824192622_creator_identity_bans_and_logo_source.sql", import.meta.url), "utf8");

test("creator email is required, validated, and masked", () => {
  assert.equal(normalizeCreatorEmail(undefined), null);
  assert.equal(normalizeCreatorEmail("not-an-email"), null);
  assert.equal(normalizeCreatorEmail(" Creator@Example.COM "), "creator@example.com");
  assert.equal(maskEmail("creator@example.com"), "c•••@example.com");
  assert.equal(creatorIdentityHash(" Creator@Example.COM "), creatorIdentityHash("creator@example.com"));
  assert.equal(creatorIdentityHash("not-an-email"), null);
});

test("publication normalization collapses equivalent platform URLs and external links stay HTTPS", () => {
  assert.equal(normalizeNewsletterUrl("https://www.samurai828.substack.com/p/build-the-smallest-honest-signal?utm_source=x").normalizedUrl, "samurai828.substack.com/");
  assert.equal(normalizeNewsletterUrl("https://samurai828.substack.com/").normalizedUrl, "samurai828.substack.com/");
  assert.equal(safeExternalUrl("https://newsletter.example.com/read"), "https://newsletter.example.com/read");
  assert.equal(safeExternalUrl("http://newsletter.example.com/read"), null);
});

test("logo extraction prioritizes the approved source order and supports custom Substack platform metadata", () => {
  const html = `<meta property="og:image" content="https://cdn.example/og.png"><meta name="twitter:image" content="https://cdn.example/twitter.png"><link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/apple.png"><script type="application/ld+json">{"publisher":{"logo":{"url":"https://cdn.example/jsonld.png"}}}</script><meta name="substack:logo" content="https://cdn.example/letterboard-l.png">`;
  const candidates = extractLogoCandidates(html);
  assert.deepEqual(candidates.map((candidate) => candidate.source), ["og:image", "twitter:image", "favicon", "apple-touch-icon", "json-ld", "platform"]);
  assert.equal(candidates.at(-1)?.url, "https://cdn.example/letterboard-l.png");
});

test("server resolver selects a valid uploaded Substack logo when higher-priority sources are absent", async () => {
  const previousFetch = globalThis.fetch;
  const html = `<html><head><title>Signal Letter</title><meta name="substack:logo" content="/letterboard-l.svg"></head></html>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="96" viewBox="0 0 320 96"><path d="M16 12v72h38" /></svg>`;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.com/") return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    if (url === "https://example.com/letterboard-l.svg") return new Response(svg, { status: 200, headers: { "content-type": "image/svg+xml", "content-length": String(Buffer.byteLength(svg)) } });
    throw new Error(`unexpected test URL: ${url}`);
  };
  try {
    const result = await resolvePublicMetadata("https://example.com/");
    assert.equal(result.logoUrl, "https://example.com/letterboard-l.svg");
    assert.equal(result.logoSource, "platform");
    assert.equal(result.logoWidth, 320);
    assert.equal(result.logoHeight, 96);
  } finally {
    globalThis.fetch = previousFetch;
  }
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
  assert.match(claimsRoute, /resolvePublicMetadata/);
  assert.match(claimsRoute, /normalizeNewsletterUrl/);
  assert.match(claimsRoute, /p_logo_url: n\.logoUrl/);
  assert.doesNotMatch(claimsRoute, /p_logo_url: body\.newsletter/);
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
  assert.match(repairRoute, /attach_claim_creator_identity/);
  assert.match(repairRoute, /creatorIdentityHash/);
  assert.match(repairRoute, /CREATOR_BANNED/);
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
  assert.match(confirmationPage, /Your Founding Mark is live\./);
  assert.match(confirmationPage, /You are confirmed as \{confirmationSummary\} on Letterboard\./);
  assert.match(confirmationPage, /FOUNDING STATUS CONFIRMED/);
  assert.match(confirmationPage, /View my public profile/);
  assert.match(confirmationPage, /Open newsletter/);
  assert.match(confirmationPage, /safeExternalUrl/);
  assert.match(confirmationPage, /ShareProfileButton/);
  assert.match(confirmationPage, /Return to the board/);
  assert.match(confirmationPage, /This confirmation link is no longer valid/);
  assert.match(confirmationPage, /ALREADY_CONFIRMED/);
  assert.match(confirmRoute, /MISSING_TOKEN/);
  assert.match(confirmRoute, /claim_id,expires_at,used_at/);
  assert.doesNotMatch(confirmationPage, /searchParams\.get\("token"\)|internal_points|contact_email/);
});

test("homepage presents Founding Mark onboarding copy and truthful empty states", () => {
  assert.match(homeClient, /Be one of the first 100 newsletters on Letterboard\./);
  assert.match(homeClient, /Claim your permanent founding position, build your public profile, and be there before the leaderboard opens to the world\./);
  assert.match(homeClient, /Free forever to claim\. No card\. No catch\./);
  assert.match(homeClient, /Paste your newsletter URL/);
  assert.match(homeClient, /Claim my spot/);
  assert.match(homeClient, /#1–5 OG · #6–10 Legend · #11–50 Icon · #51–100 Pioneer/);
  assert.match(homeClient, /Founding spots claimed/);
  assert.match(homeClient, /After the Founding 100 closes, Spotlight opens for featured visibility without changing organic founding status\./);
  assert.match(homeClient, /board\.stats\.claimed === 1 \? "place" : "places"/);
  assert.match(homeClient, /board\.stats\.total - board\.stats\.claimed/);
  assert.doesNotMatch(homeClient, /visitors|online now|fake activity/i);
  assert.match(leaderboard, /Who gets there first\?/);
  assert.match(leaderboard, /Letterboard starts empty\. The first verified newsletter takes #01\./);
  assert.match(leaderboard, /Nothing yet\. You could start it\./);
  assert.match(leaderboard, /The live board\./);
  assert.doesNotMatch(leaderboard, /First on Letterboard|places claimed|Hero/);
  assert.match(boardmark, /Founding Mark/);
});

test("public copy has no stale Boardmark or Hero terminology", async () => {
  const files = [
    homeClient,
    leaderboard,
    claimFlow,
    confirmationPage,
    publicProfilePage,
    await readFile(new URL("../app/components/ShareCard.tsx", import.meta.url), "utf8"),
  ];
  for (const source of files) {
    assert.doesNotMatch(source, />[^<]*(Founding Boardmark|First on Letterboard|\bHero\b|\bBoardmark\b)[^<]*</i);
    assert.doesNotMatch(source, /aria-label="[^"]*(Founding Boardmark|\bHero\b|\bBoardmark\b)/i);
  }
  for (const tier of ["og", "legend", "icon", "pioneer"]) {
    const mark = await readFile(new URL(`../public/brand/boardmarks/boardmark-${tier}.svg`, import.meta.url), "utf8");
    assert.doesNotMatch(mark, /<(?:title|desc)>[^<]*(Founding Boardmark|\bHero\b|\bBoardmark\b)/i);
  }
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
  assert.match(repairRoute, /attach_claim_creator_identity/);
  assert.match(hardeningMigration, /coalesce\(contact_email, p_contact_email\)/);
  assert.match(hardeningMigration, /p_identity_hash/);
  assert.match(repairRoute, /sendOwnershipEmail/);
  assert.doesNotMatch(repairRoute, /from\("claims"\)\.insert/);
});

test("legacy repair protects existing emails, reports provider failure, and does not leak tokens", () => {
  assert.match(repairRoute, /CLAIM_EMAIL_MISMATCH/);
  assert.match(hardeningMigration, /CLAIM_EMAIL_MISMATCH/);
  assert.match(repairRoute, /email\.reason/);
  assert.match(repairRoute, /providerCalled: true/);
  assert.doesNotMatch(repairRoute, /console\.(info|warn|error)\([^\n]*rawToken/);
  assert.doesNotMatch(repairRoute, /console\.(info|warn|error)\([^\n]*(creatorEmail|contact_email)/);
});

test("one creator, duplicate publication, and permanent ban safeguards are database-backed", () => {
  assert.match(hardeningMigration, /create extension if not exists pgcrypto with schema extensions/);
  assert.match(hardeningMigration, /extensions\.digest\(lower\(trim\(contact_email\)\)::text, 'sha256'::text\)/);
  assert.match(hardeningMigration, /extensions\.digest\(lower\(trim\(c\.contact_email\)\)::text, 'sha256'::text\)/);
  assert.doesNotMatch(hardeningMigration, /(?<!extensions\.)digest\(/);
  assert.match(hardeningMigration, /creator_identities/);
  assert.match(hardeningMigration, /identity_hash text not null unique/);
  assert.match(hardeningMigration, /claims_one_active_creator_idx/);
  assert.match(hardeningMigration, /status in \('pending', 'confirmed'\)/);
  assert.match(hardeningMigration, /create_pending_claim/);
  assert.match(hardeningMigration, /PUBLICATION_ALREADY_CLAIMED/);
  assert.match(hardeningMigration, /CREATOR_ALREADY_CLAIMED/);
  assert.match(hardeningMigration, /creator_bans/);
  assert.match(hardeningMigration, /ban_creator/);
  assert.match(hardeningMigration, /CREATOR_BANNED/);
  assert.match(hardeningMigration, /admin_audit_log/);
  assert.match(banRoute, /ADMIN_REVIEW_TOKEN/);
  assert.match(banRoute, /authorization/);
  assert.match(banRoute, /creatorIdentityHash/);
  assert.match(banRoute, /ban_creator/);
  assert.doesNotMatch(banRoute, /console\.(info|warn|error)/);
});

test("live board reconciliation refreshes without a manual reload", () => {
  assert.match(homeClient, /setInterval\(refreshBoard, 10_000\)/);
  assert.match(homeClient, /visibilitychange/);
  assert.match(homeClient, /router\.refresh\(\)/);
  assert.match(homeClient, /claimTarget/);
  assert.match(claimFlow, /liveNewsletter/);
  assert.match(claimFlow, /onClaimCreated/);
  assert.match(claimFlow, /setStatus\("confirmed"\)/);
});

test("public profile is branded, private-safe, and links externally", () => {
  assert.match(publicProfilePage, /NewsletterLogo/);
  assert.match(publicProfilePage, /Read newsletter/);
  assert.match(publicProfilePage, /target="_blank"/);
  assert.match(publicProfilePage, /noopener noreferrer/);
  assert.match(publicProfilePage, /ShareCard/);
  assert.match(publicProfilePage, /profile_views/);
  assert.doesNotMatch(publicProfilePage, /contact_email|internal_points|creator_identity_hash/);
});
