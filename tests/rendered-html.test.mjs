import assert from "node:assert/strict";
import test from "node:test";

const letterboardTitle = /<title>Letterboard — the live board for newsletters<\/title>/i;
const founding100Copy = /THE FOUNDING 100 IS OPEN/i;
const boardmarkMarkup = /FOUNDING 100/i;

test("renders the Letterboard Founding 100 board", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, letterboardTitle);
  assert.match(html, founding100Copy);
  assert.match(html, boardmarkMarkup);
});
