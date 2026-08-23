import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canonical Letterboard assets preserve the boxed L and Boardmark", async () => {
  const logo = await readFile(new URL("../public/letterboard-logo.svg", import.meta.url), "utf8");
  const mark = await readFile(new URL("../public/boardmark.svg", import.meta.url), "utf8");
  assert.match(logo, /<rect/);
  assert.match(logo, /M17 15v22h18/);
  assert.match(mark, /FOUNDING 100/);
  assert.match(mark, /coral|#f15c49/i);
});
