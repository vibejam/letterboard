import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSharePlan, inferSharePlatformFromCanonicalUrl, isWhitelistedShareUrl, publicProfileUrl, xCharacterLimit } from "../lib/share.ts";

const button = await readFile(new URL("../app/components/ShareProfileButton.tsx", import.meta.url), "utf8");
const claimFlow = await readFile(new URL("../app/components/ClaimFlow.tsx", import.meta.url), "utf8");
const profilePage = await readFile(new URL("../app/[slug]/page.tsx", import.meta.url), "utf8");
const confirmationPage = await readFile(new URL("../app/confirmation/page.tsx", import.meta.url), "utf8");
const shareCard = await readFile(new URL("../app/components/ShareCard.tsx", import.meta.url), "utf8");
const boardLib = await readFile(new URL("../lib/board.ts", import.meta.url), "utf8");
const profileRoute = await readFile(new URL("../app/api/profiles/[slug]/route.ts", import.meta.url), "utf8");

const details = {
  slug: "signal-letter",
  newsletterName: "Signal Letter",
  foundingPosition: 7,
  tier: "legend",
  profileUrl: publicProfileUrl("signal-letter"),
  newsletterUrl: "https://signal-letter.example/read",
};

for (const platform of ["substack", "medium", "x", "linkedin", "unknown"]) {
  test(`${platform} share message contains only public founding details`, () => {
    const plan = buildSharePlan({ ...details, sourcePlatform: platform });
    assert.match(plan.message, /Signal Letter/);
    assert.match(plan.message, /#7/);
    assert.match(plan.message, /LEGEND/);
    assert.match(plan.message, /Founding Mark/);
    assert.match(plan.message, /https:\/\/www\.letterboard\.lol\/signal-letter/);
    assert.doesNotMatch(plan.message, /private|email|internal_points|confirmation|token|admin/i);
  });
}

test("Substack copies first and opens the signed-in web experience", () => {
  const plan = buildSharePlan({ ...details, sourcePlatform: "substack" });
  assert.equal(plan.destination, "https://substack.com/home");
  assert.equal(plan.copyBeforeOpen, true);
  assert.equal(plan.toast, "Your Note is ready — paste it into Substack.");
  assert.doesNotMatch(plan.toast, /published|posted/i);
});

test("Medium uses the supported writing destination without claiming a draft was created", () => {
  const plan = buildSharePlan({ ...details, sourcePlatform: "medium" });
  assert.equal(plan.destination, "https://medium.com/new-story");
  assert.equal(plan.copyBeforeOpen, true);
  assert.equal(plan.toast, "Your Medium draft is ready — paste the message and publish when ready.");
  assert.doesNotMatch(plan.toast, /created|published/i);
});

test("X uses an encoded web intent with the profile URL and stays within 280 characters", () => {
  const plan = buildSharePlan({ ...details, newsletterName: "A ".repeat(200), sourcePlatform: "x" });
  const intent = new URL(plan.destination);
  assert.equal(intent.origin, "https://x.com");
  assert.equal(intent.pathname, "/intent/post");
  assert.equal(intent.searchParams.get("url"), details.profileUrl);
  assert.ok((intent.searchParams.get("text") ?? "").length <= xCharacterLimit);
  assert.equal(plan.copyBeforeOpen, false);
  assert.equal(isWhitelistedShareUrl(plan.destination, "x"), true);
});

test("LinkedIn copies the message and opens the post composer", () => {
  const plan = buildSharePlan({ ...details, sourcePlatform: "linkedin" });
  assert.equal(plan.destination, "https://www.linkedin.com/feed/?shareActive=true");
  assert.equal(plan.copyBeforeOpen, true);
  assert.equal(plan.toast, "Message copied — paste it into your LinkedIn post and publish.");
});

test("unknown platforms copy and fall back to the verified publication URL", () => {
  const plan = buildSharePlan({ ...details, sourcePlatform: "beehiiv" });
  assert.equal(plan.platform, "unknown");
  assert.equal(plan.destination, details.newsletterUrl);
  assert.equal(plan.fallback, true);
  assert.equal(plan.toast, "Your share message is copied.");
});

test("null source_platform safely falls back to the verified canonical URL host", () => {
  const cases = [
    ["https://signal.substack.com/", "substack"],
    ["https://medium.com/@signal/hello", "medium"],
    ["https://x.com/signal", "x"],
    ["https://www.linkedin.com/newsletters/signal", "linkedin"],
  ];
  for (const [url, platform] of cases) {
    assert.equal(inferSharePlatformFromCanonicalUrl(url), platform);
    assert.equal(buildSharePlan({ ...details, sourcePlatform: null, newsletterUrl: url }).platform, platform);
  }
  assert.equal(inferSharePlatformFromCanonicalUrl("http://signal.substack.com/"), "unknown");
});

test("public board and profile responses infer supported platforms when metadata is null", () => {
  assert.match(boardLib, /source_platform: row\.source_platform \?\?/);
  assert.match(boardLib, /inferSharePlatformFromCanonicalUrl\(row\.canonical_url\)/);
  assert.match(profileRoute, /source_platform: result\.data\.source_platform \?\?/);
  assert.match(profileRoute, /inferSharePlatformFromCanonicalUrl\(result\.data\.canonical_url\)/);
});

test("share destinations reject non-HTTPS URLs and non-platform hosts", () => {
  assert.equal(publicProfileUrl("not a safe slug"), null);
  assert.equal(isWhitelistedShareUrl("http://x.com/intent/post", "x"), false);
  assert.equal(isWhitelistedShareUrl("https://evil.example/intent/post", "x"), false);
  assert.equal(isWhitelistedShareUrl("https://x.com/intent/post?text=hello", "x"), true);
});

test("the chooser keeps destination selection explicit and supports copy/share-sheet paths", () => {
  const copy = buildSharePlan({ ...details, sourcePlatform: "substack" }, "copy");
  assert.equal(copy.platform, "copy");
  assert.equal(copy.copyText, details.profileUrl);
  const sheet = buildSharePlan({ ...details, sourcePlatform: "substack" }, "share");
  assert.equal(sheet.platform, "share");
  assert.equal(sheet.destination, null);
  assert.match(button, /Choose where to share/);
  assert.match(button, /Substack Notes/);
  assert.match(button, /More \/ share sheet/);
  assert.match(button, /share_started/);
  assert.match(button, /share_platform_selected/);
  assert.match(button, /share_link_copied/);
  assert.match(button, /share_composer_opened/);
  assert.doesNotMatch(button, /share_posted/);
});

test("clipboard failures expose a branded copy panel without private fields", () => {
  assert.match(button, /navigator\.clipboard/);
  assert.match(button, /share-copy-panel/);
  assert.match(button, /Copy message/);
  assert.match(button, /target = "_blank"/);
  assert.match(button, /rel = "noopener noreferrer"/);
  assert.doesNotMatch(button, /internal_points|contact_email|confirmationToken|adminData/);
});

test("the shared share action is wired to confirmation, profile, and share-card views", () => {
  assert.match(confirmationPage, /ShareProfileButton[\s\S]*sourcePlatform/);
  assert.match(profilePage, /ShareProfileButton[\s\S]*sourcePlatform/);
  assert.match(shareCard, /ShareProfileButton/);
  assert.match(claimFlow, /ShareProfileButton/);
});
