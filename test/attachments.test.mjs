// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.FRESHDESK_API_KEY = "k";
process.env.FRESHDESK_DOMAIN = "x.freshdesk.com";
const { isAllowedUrl, extractImgSrcs, imageSize, download } = await import("../dist/tools/attachments.js");

test("isAllowedUrl only allows https on allowlisted host suffixes", () => {
  assert.ok(isAllowedUrl("https://acme.attachments5.freshdesk.com/data/a.png?Expires=1&Signature=x"));
  assert.ok(isAllowedUrl("https://s3.amazonaws.com/bucket/a.png"));
  assert.ok(!isAllowedUrl("http://acme.freshdesk.com/a.png"), "plain http");
  assert.ok(!isAllowedUrl("https://169.254.169.254/latest/meta-data"), "metadata IP");
  assert.ok(!isAllowedUrl("https://evilfreshdesk.com/a.png"), "suffix without dot");
  assert.ok(!isAllowedUrl("https://freshdesk.com.evil.io/a.png"), "suffix spoof");
  assert.ok(!isAllowedUrl("https://user:pw@acme.freshdesk.com/a.png"), "credentials");
  assert.ok(!isAllowedUrl("https://acme.freshdesk.com:8443/a.png"), "odd port");
});

test("download re-checks allowlist on redirects", async () => {
  globalThis.fetch = async () =>
    new Response(null, { status: 302, headers: { location: "http://10.0.0.1/secret" } });
  const r = await download("https://acme.freshdesk.com/a.png");
  assert.equal(r.ok, false);
  assert.match(r.reason, /host not allowed/);
});

test("download aborts bodies over the size cap", async () => {
  globalThis.fetch = async () => new Response(new Uint8Array(2048));
  const r = await download("https://acme.freshdesk.com/a.png", 1024);
  assert.equal(r.ok, false);
  assert.match(r.reason, /too large/);
});

test("extractImgSrcs decodes &amp; and handles quote styles", () => {
  const html = `<p><img src="https://a.freshdesk.com/x.png?Expires=1&amp;Signature=2"><img alt=x src='cid:abc'><img src=data:image/png;base64,AA></p>`;
  assert.deepEqual(extractImgSrcs(html), [
    "https://a.freshdesk.com/x.png?Expires=1&Signature=2",
    "cid:abc",
    "data:image/png;base64,AA",
  ]);
  assert.deepEqual(extractImgSrcs(null), []);
});

test("imageSize reads PNG, GIF and JPEG headers", () => {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(imageSize(png), { width: 640, height: 480 });

  const gif = Buffer.from("GIF89a\x10\x00\x20\x00", "binary");
  assert.deepEqual(imageSize(gif), { width: 16, height: 32 });

  // SOI, then SOF0 segment: len=17, precision, height=50, width=80
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x32, 0x00, 0x50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageSize(jpg), { width: 80, height: 50 });

  assert.equal(imageSize(Buffer.from("RIFF....WEBP")), null);
});
