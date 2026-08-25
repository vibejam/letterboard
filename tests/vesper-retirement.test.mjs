import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260825134008_retire_vesper_test_listing.sql", import.meta.url), "utf8");
const reasonFixMigration = await readFile(new URL("../supabase/migrations/20260825135032_fix_vesper_retirement_audit_reason.sql", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/admin/retire-vesper-test/route.ts", import.meta.url), "utf8");

test("Vesper retirement is exact, transactional, idempotent, and audit-preserving", () => {
  assert.match(migration, /vespers-letterboard-substack/);
  assert.match(migration, /https:\/\/vesperwilder\.substack\.com\//);
  assert.match(migration, /v_newsletter\.founding_position <> 1/);
  assert.match(migration, /status = 'rejected'/);
  assert.match(migration, /founding_position = null/);
  assert.match(migration, /founding_tier = null/);
  assert.match(migration, /is_published = false/);
  assert.match(migration, /ownership_verifications[\s\S]*used_at = now\(\)/);
  assert.match(migration, /admin_audit_log/);
  assert.match(migration, /Vesper test listing cleanup/);
  assert.match(reasonFixMigration, /internal test listing cleanup/);
  assert.match(migration, /already_retired/);
  assert.match(route, /ADMIN_REVIEW_TOKEN/);
  assert.match(route, /retire_vesper_test_listing/);
  assert.doesNotMatch(route, /from\("claims"\)\.insert/);
});

test("onboarding guards rapid profile-preview and Done transitions", async () => {
  const claimFlow = await readFile(new URL("../app/components/ClaimFlow.tsx", import.meta.url), "utf8");
  assert.match(claimFlow, /previewedProfile/);
  assert.match(claimFlow, /step === "profile"/);
  assert.match(claimFlow, /disabled=\{transitioning\}/);
  assert.match(claimFlow, /function closeProfile/);
  assert.match(claimFlow, /function previewProfile/);
  assert.match(claimFlow, /setStep\("profile"\); setTransitioning\(false\)/);
});
