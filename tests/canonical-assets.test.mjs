import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canonical Letterboard assets preserve the boxed L and Boardmark", async () => {
  const logo = await readFile(new URL("../public/letterboard-logo.svg", import.meta.url), "utf8");
  assert.match(logo, /<rect/);
  assert.match(logo, /M17 15v22h18/);

  const tiers = ["og", "legend", "icon", "pioneer"];
  for (const tier of tiers) {
    const mark = await readFile(new URL(`../public/brand/boardmarks/boardmark-${tier}.svg`, import.meta.url), "utf8");
    assert.match(mark, /<svg width="320" height="96" viewBox="0 0 320 96"/);
    assert.match(mark, /M42 31V64H61/);
    assert.match(mark, /M91 25H111M91 36H111M91 47H111/);
    assert.match(mark, /M132 18V78/);
    assert.match(mark, /cx="178" cy="48"/);
    assert.doesNotMatch(mark, /M42 31L/);
  }
});

test("confirmed Boardmark tiers use shared artwork and pending remains separate", async () => {
  const component = await readFile(new URL("../app/components/Boardmark.tsx", import.meta.url), "utf8");
  assert.match(component, /BoardmarkTier = "og" \| "legend" \| "icon" \| "pioneer"/);
  assert.match(component, /\/brand\/boardmarks\/boardmark-og\.svg/);
  assert.match(component, /if \(status === "pending"\) return <PendingBoardmark/);
  assert.doesNotMatch(component, /\/boardmark(?:-pending)?\.svg/);
});
