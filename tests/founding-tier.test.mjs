import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260824040407_founding_tier_points.sql", import.meta.url), "utf8");
const dualVerificationMigration = await readFile(new URL("../supabase/migrations/20260825132929_dual_ownership_verification.sql", import.meta.url), "utf8");
const baseMigration = await readFile(new URL("../supabase/migrations/20260822190743_founding100_schema.sql", import.meta.url), "utf8");
const claimsRoute = await readFile(new URL("../app/api/claims/route.ts", import.meta.url), "utf8");
const confirmRoute = await readFile(new URL("../app/api/claims/confirm/route.ts", import.meta.url), "utf8");
const boardLib = await readFile(new URL("../lib/board.ts", import.meta.url), "utf8");
const profileRoute = await readFile(new URL("../app/api/profiles/[slug]/route.ts", import.meta.url), "utf8");
const adminRoute = await readFile(new URL("../app/api/admin/reviews/route.ts", import.meta.url), "utf8");

const tiers = [
  { first: 1, last: 5, tier: "og", points: 1000 },
  { first: 6, last: 10, tier: "legend", points: 500 },
  { first: 11, last: 50, tier: "icon", points: 250 },
  { first: 51, last: 100, tier: "pioneer", points: 100 },
];

for (const position of [1, 5, 6, 10, 11, 50, 51, 100]) {
  test(`position ${position} maps to the authoritative founding tier and points`, () => {
    const expected = tiers.find(({ first, last }) => position >= first && position <= last);
    assert.ok(expected);
    assert.match(migration, new RegExp(`v_position between ${expected.first} and ${expected.last}[\\s\\S]*?v_tier := '${expected.tier}';[\\s\\S]*?v_points := ${expected.points};`));
  });
}

test("position 101 is rejected and the database range remains 1 through 100", () => {
  assert.match(migration, /founding_position between 1 and 100/);
  assert.match(migration, /FOUNDING_100_FULL/);
});

test("tier and points cannot be supplied by the client", () => {
  assert.doesNotMatch(claimsRoute, /founding_tier|internal_points/);
  assert.doesNotMatch(confirmRoute, /await request\.json\(\)|internal_points/);
  assert.match(migration, /founding_tier = v_tier/);
  assert.match(migration, /internal_points = v_points/);
});

test("confirmed authority is immutable and cannot be transferred or edited", () => {
  assert.match(migration, /FOUNDING_AUTHORITY_IMMUTABLE/);
  assert.match(migration, /new\.founding_position is distinct from old\.founding_position/);
  assert.match(migration, /new\.founding_tier is distinct from old\.founding_tier/);
  assert.match(migration, /new\.internal_points is distinct from old\.internal_points/);
  assert.match(adminRoute, /confirm_claim_by_admin/);
});

test("public responses expose founding_tier but never internal_points", () => {
  assert.match(boardLib, /founding_tier/);
  assert.match(profileRoute, /founding_tier/);
  assert.doesNotMatch(boardLib, /internal_points/);
  assert.doesNotMatch(profileRoute, /internal_points/);
  assert.match(migration, /revoke select on public\.newsletters from anon, authenticated/);
  assert.match(migration, /founding_position, founding_tier,/);
  assert.doesNotMatch(migration, /grant select \([^)]*internal_points/);
});

test("pending profiles and duplicate confirmations remain protected", () => {
  assert.match(profileRoute, /ownership_status.*confirmed/);
  assert.match(confirmRoute, /used_at/);
  assert.match(migration, /ov\.used_at is null/);
  assert.match(migration, /c\.status = 'pending'/);
  assert.match(migration, /set used_at = now\(\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('letterboard-founding-100'\)\)/);
  assert.match(baseMigration, /founding_position integer unique/);
});

test("confirmation assigns the tier exactly once in the transaction", () => {
  assert.match(migration, /returns table \(confirmed boolean, founding_position integer, founding_tier text, profile_slug text\)/);
  assert.equal((migration.match(/create or replace function public\.confirm_ownership/g) ?? []).length, 1);
  assert.match(dualVerificationMigration, /claim_founding_position/);
  assert.match(dualVerificationMigration, /founding_tier = v_tier/);
  assert.match(confirmRoute, /status: "email_verified"/);
});
