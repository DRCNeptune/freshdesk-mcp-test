// Run: npm run build && node --test test/
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.FRESHDESK_API_KEY = "k";
process.env.FRESHDESK_DOMAIN = "x.freshdesk.com";
const { listConversations } = await import("../dist/tools/tickets.js");

// 3 pages of 2 conversations each; Link header points to the next page like Freshdesk does.
globalThis.fetch = async (url) => {
  const page = Number(new URL(url).searchParams.get("page"));
  const headers = new Headers();
  if (page < 3) headers.set("link", `<https://x.freshdesk.com/api/v2/tickets/1/conversations?page=${page + 1}>; rel="next"`);
  return new Response(JSON.stringify([{ id: page * 10 + 1 }, { id: page * 10 + 2 }]), { headers });
};
const run = async (args) =>
  JSON.parse((await listConversations("/tickets/1/conversations", { page: 1, per_page: 2, fetch_all: true, max_pages: 20, ...args }, "x")).content[0].text);

test("fetch_all follows Link header to the last page", async () => {
  const r = await run({});
  assert.equal(r.total_returned, 6);
  assert.equal(r.pages_fetched, 3);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.conversations.at(-1), { id: 32 });
});

test("max_pages caps and reports truncation", async () => {
  const r = await run({ max_pages: 2 });
  assert.equal(r.total_returned, 4);
  assert.equal(r.truncated, true);
  assert.equal(r.next_page, 3);
});

test("fetch_all=false returns one page with pagination", async () => {
  const r = await run({ fetch_all: false, page: 2 });
  assert.equal(r.conversations.length, 2);
  assert.deepEqual(r.pagination, { current_page: 2, next_page: 3, prev_page: null, per_page: 2 });
});
