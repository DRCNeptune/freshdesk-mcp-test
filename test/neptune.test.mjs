// Fork only: page rendering, image conversion and the Neptune DXP export summary.
// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { makePdf } from "./fixtures.mjs";

process.env.FRESHDESK_API_KEY = "k";
process.env.FRESHDESK_DOMAIN = "x.freshdesk.com";
const { Budget, extractAny, optionalCapabilities } = await import("../dist/extract.js");
await import("../dist/extract-neptune.js");

const budget = () => new Budget({ maxTextChars: 60_000, maxPages: 5, maxImages: 10, harRaw: false });
const images = (r) => r.content.filter((c) => c.type === "image").length;

test("the optional rendering and conversion libraries are installed", async () => {
  assert.deepEqual(await optionalCapabilities(), {
    renderPdfPages: true,
    convertImages: true,
    convertHeic: true,
  });
});

test("a scanned PDF page is rendered as an image", async () => {
  const r = await extractAny(makePdf([["A page with enough text to count as text"], []]), "s.pdf", "", budget());
  assert.equal(images(r), 1);
  assert.match(r.handling, /1 page\(s\) rendered as images/);
});

test("a BMP is converted to PNG", async () => {
  // 2x2, 24-bit BMP.
  const bmp = Buffer.alloc(70);
  bmp.write("BM", 0, "ascii");
  bmp.writeUInt32LE(70, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(2, 18);
  bmp.writeInt32LE(2, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(16, 34);
  const r = await extractAny(bmp, "scan.bmp", "", budget());
  assert.equal(images(r), 1);
  assert.equal(r.content.find((c) => c.type === "image").mimeType, "image/png");
});

test("a Neptune DXP application export gets a summary", async () => {
  const row = (tag, fields) =>
    `<${tag}>${Object.entries(fields)
      .map(([k, v]) => `<${k}>${v}</${k}>`)
      .join("")}</${tag}>`;
  const xml = `<?xml version="1.0"?><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><PROJECT><APPLICATION><APPLID>DEMO_APP</APPLID><DESCR>Demo application</DESCR><VERSION>0001</VERSION></APPLICATION><IT_CONTENT>${row("_-NEPTUNE_-_OBJ", { FIELD_ID: "00002", FIELD_NAME: "Enum.ABC", FIELD_TYPE: "TYPESCRIPT", FIELD_PARENT: "00000", FIELD_POS: "00001" })}</IT_CONTENT><IT_TYPESCRIPT>${row("_-NEPTUNE_-_TSCRIP", { FIELD_ID: "00002", SEQNR: "00002", TEXT: "  B = 'B'," })}${row("_-NEPTUNE_-_TSCRIP", { FIELD_ID: "00002", SEQNR: "00001", TEXT: "enum ABC {" })}</IT_TYPESCRIPT></PROJECT></asx:values></asx:abap>`;
  const r = await extractAny(Buffer.from(xml), "demo.xml", "", budget());
  const t = r.content.map((c) => c.text ?? "").join("\n");
  assert.match(t, /# Neptune DXP application export: DEMO_APP/);
  assert.match(t, /- Enum\.ABC \(TYPESCRIPT, id 00002\)/);
  assert.match(t, /```ts\nenum ABC \{\n {2}B = 'B',\n```/, "source rebuilt in SEQNR order");
  assert.doesNotMatch(t, /<asx:abap/, "full XML only with xml_full");
});
