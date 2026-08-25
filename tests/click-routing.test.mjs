import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { safeRedirectUrl } from "../lib/urls.ts";

const board = await readFile(new URL("../lib/board.ts", import.meta.url), "utf8");
const boardApi = await readFile(new URL("../app/api/board/route.ts", import.meta.url), "utf8");
const profileApi = await readFile(new URL("../app/api/profiles/[slug]/route.ts", import.meta.url), "utf8");
const profilePage = await readFile(new URL("../app/[slug]/page.tsx", import.meta.url), "utf8");
const leaderboard = await readFile(new URL("../app/components/Leaderboard.tsx", import.meta.url), "utf8");
const redirect = await readFile(new URL("../app/go/[slug]/route.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260825113220_newsletter_clicks.sql", import.meta.url), "utf8");
const metadataRefresh = await readFile(new URL("../app/api/admin/metadata/refresh/route.ts", import.meta.url), "utf8");

test("leaderboard measures newsletter clicks and never increments profile views", () => {
  assert.match(migration, /create table if not exists public\.newsletter_clicks/);
  assert.match(migration, /newsletter_id uuid not null references public\.newsletters\(id\)/);
  assert.match(board, /from\("newsletter_clicks"\)/);
  assert.match(board, /newsletter_clicks: clickCounts\.get/);
  assert.doesNotMatch(board, /profile_views/);
  assert.doesNotMatch(leaderboard, /profile views|VIEWS/);
  assert.match(leaderboard, /CLICKS/);
  assert.doesNotMatch(profileApi, /profile_views/);
  assert.doesNotMatch(profilePage, /profile_views/);
  assert.match(profileApi, /newsletter_clicks/);
  assert.match(profilePage, /Newsletter clicks?/);
  assert.match(boardApi, /getBoardPayload/);
});

test("confirmed board destinations use a counted HTTPS redirect and reject unsafe targets", () => {
  assert.match(redirect, /ownership_status/, "only confirmed slugs may redirect");
  assert.match(redirect, /safeRedirectUrl\(result\.data\.canonical_url\)/);
  assert.match(redirect, /from\("newsletter_clicks"\)\.insert/);
  assert.match(redirect, /NextResponse\.redirect\(destination/);
  assert.match(leaderboard, /href=\{destination\}/);
  assert.match(leaderboard, /target="_blank" rel="noopener noreferrer"/);
  assert.match(leaderboard, /newsletter_external_click/);
  assert.equal(safeRedirectUrl("https://newsletter.example/read"), "https://newsletter.example/read");
  assert.equal(safeRedirectUrl("http://newsletter.example/read"), null);
  assert.equal(safeRedirectUrl("https://localhost/private"), null);
  assert.equal(safeRedirectUrl("https://user:pass@newsletter.example/read"), null);
});

test("metadata refresh is admin-only, preview-first, and restricted to metadata fields", () => {
  assert.match(metadataRefresh, /ADMIN_REVIEW_TOKEN/);
  assert.match(metadataRefresh, /persist !== true/);
  assert.match(metadataRefresh, /resolvePublicMetadata/);
  assert.match(metadataRefresh, /logo_url/);
  assert.match(metadataRefresh, /logo_source/);
  assert.match(metadataRefresh, /source_platform/);
  assert.match(metadataRefresh, /metadata_status/);
  assert.doesNotMatch(metadataRefresh, /internal_points|founding_position|founding_tier|contact_email|creator_identity/);
});
