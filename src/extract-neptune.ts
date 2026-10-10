/**
 * Summary of Neptune DXP application exports (asx:abap XML). Registered as an XML
 * summarizer, so the model first gets the application header, its object tree and
 * the reconstructed source code (scripts, TypeScript, CSS, HTML, event scripts)
 * instead of thousands of XML rows, followed by the formatted XML.
 *
 * Neptune-specific: kept in its own file so it can live outside the upstream project.
 */
import { decodeXmlEntities, xmlSummarizers } from "./extract.js";

type Row = Record<string, string>;

/** Rows of a table such as IT_SCRIPT: each child element becomes a field map. */
function tableRows(xml: string, table: string): Row[] {
  const block = xml.match(new RegExp(`<${table}>([\\s\\S]*?)</${table}>`))?.[1];
  if (!block) return [];
  const itemTag = block.match(/<([\w-]+)>/)?.[1];
  if (!itemTag) return [];
  const rows: Row[] = [];
  for (const item of block.matchAll(new RegExp(`<${itemTag}>([\\s\\S]*?)</${itemTag}>`, "g"))) {
    const row: Row = {};
    for (const f of item[1].matchAll(/<([\w-]+)>([\s\S]*?)<\/\1>|<([\w-]+)\/>/g)) {
      if (f[1]) row[f[1]] = decodeXmlEntities(f[2]);
      else if (f[3]) row[f[3]] = "";
    }
    rows.push(row);
  }
  return rows;
}

/** Fields of a single structure such as APPLICATION. */
function structure(xml: string, name: string): Row {
  const block = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "";
  const row: Row = {};
  for (const f of block.matchAll(/<([\w-]+)>([\s\S]*?)<\/\1>/g))
    row[f[1]] = decodeXmlEntities(f[2]);
  return row;
}

const seq = (r: Row) => Number(r.SEQNR ?? 0);

/** Joins source lines stored one row per line, ordered by SEQNR. */
function source(rows: Row[]): string {
  return [...rows]
    .sort((a, c) => seq(a) - seq(c))
    .map((r) => r.TEXT ?? "")
    .join("\n");
}

function groupBy(rows: Row[], key: (r: Row) => string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k) ?? [];
    list.push(r);
    map.set(k, list);
  }
  return map;
}

const HEADER_FIELDS: [string, string][] = [
  ["APPLID", "Application"],
  ["DESCR", "Description"],
  ["VERSION", "Version"],
  ["APP_TYPE", "Type"],
  ["DEVCLASS", "Package"],
  ["TR_ORDER", "Transport"],
  ["SAPUI5_VERSION", "SAPUI5 version"],
  ["SAPUI5_THEME", "SAPUI5 theme"],
  ["ICFNODE", "ICF node"],
  ["STATEFUL", "Stateful"],
  ["CLSNAME", "Class"],
  ["TS_COMPILE_TARGET", "TypeScript target"],
];

const SOURCE_TABLES: { table: string; label: string; lang: string; byEvent?: boolean }[] = [
  { table: "IT_TYPESCRIPT", label: "TypeScript", lang: "ts" },
  { table: "IT_SCRIPT", label: "JavaScript", lang: "js" },
  { table: "IT_EVENT_SCRIPT", label: "Event script", lang: "js", byEvent: true },
  { table: "IT_HTML", label: "HTML", lang: "html" },
];

const CSS_TABLES: [string, string][] = [
  ["IT_CSS_DESKTOP", "Desktop"],
  ["IT_CSS_TABLET", "Tablet"],
  ["IT_CSS_MOBILE", "Mobile"],
];

export function summarizeNeptuneApp(xml: string): { title: string; summary: string } | null {
  if (!xml.includes("<asx:abap") || !/<PROJECT>[\s\S]*?<APPLICATION>[\s\S]*?<APPLID>/.test(xml))
    return null;

  const app = structure(xml, "APPLICATION");
  const out: string[] = [`# Neptune DXP application export: ${app.APPLID ?? "(unknown)"}`, ""];

  const header = HEADER_FIELDS.filter(([k]) => app[k]).map(
    ([k, label]) => `| ${label} | ${app[k]} |`,
  );
  if (app.CRENAM || app.CREDAT)
    header.push(`| Created | ${[app.CRENAM, app.CREDAT, app.CRETIM].filter(Boolean).join(" ")} |`);
  if (app.UPDNAM || app.UPDDAT)
    header.push(
      `| Last changed | ${[app.UPDNAM, app.UPDDAT, app.UPDTIM].filter(Boolean).join(" ")} |`,
    );
  out.push("| Field | Value |", "| --- | --- |", ...header, "");

  // Object tree, ordered by parent and position.
  const objects = tableRows(xml, "IT_CONTENT");
  const names = new Map(objects.map((o) => [o.FIELD_ID, o.FIELD_NAME || o.FIELD_ID]));
  const children = groupBy(objects, (o) => o.FIELD_PARENT ?? "00000");
  const tree: string[] = [];
  const walk = (parent: string, depth: number) => {
    const list = (children.get(parent) ?? []).sort(
      (a, c) => Number(a.FIELD_POS) - Number(c.FIELD_POS),
    );
    for (const o of list) {
      tree.push(
        `${"  ".repeat(depth)}- ${o.FIELD_NAME || "(no name)"} (${o.FIELD_TYPE || "?"}, id ${o.FIELD_ID}${o.DISABLED ? ", disabled" : ""})`,
      );
      if (o.FIELD_ID !== parent) walk(o.FIELD_ID, depth + 1);
    }
  };
  walk("00000", 0);
  out.push(`## Objects (${objects.length})`, "", tree.length ? tree.join("\n") : "(none)", "");

  // Source code stored one row per line, reconstructed per object.
  for (const { table, label, lang, byEvent } of SOURCE_TABLES) {
    const rows = tableRows(xml, table);
    if (!rows.length) continue;
    const groups = groupBy(rows, (r) =>
      byEvent ? `${r.FIELD_ID}|${r.EVENT ?? ""}` : (r.FIELD_ID ?? ""),
    );
    out.push(`## ${label} (${groups.size} block(s))`, "");
    for (const [key, list] of groups) {
      const [fieldId, event] = key.split("|");
      const title = `${names.get(fieldId) ?? fieldId} (id ${fieldId}${event ? `, event ${event}` : ""})`;
      out.push(`### ${title}`, "", `\`\`\`${lang}`, source(list), "```", "");
    }
  }

  for (const [table, label] of CSS_TABLES) {
    const rows = tableRows(xml, table);
    if (rows.length) out.push(`## CSS ${label}`, "", "```css", source(rows), "```", "");
  }

  const manifest = tableRows(xml, "IT_MANIFEST");
  if (manifest.length) out.push("## Manifest", "", "```json", source(manifest), "```", "");

  // Remaining tables: just how many rows they hold.
  const shown = new Set([
    "IT_CONTENT",
    "IT_MANIFEST",
    ...SOURCE_TABLES.map((s) => s.table),
    ...CSS_TABLES.map((c) => c[0]),
  ]);
  const others = [...xml.matchAll(/<(IT_[A-Z0-9_]+)>/g)]
    .map((m) => m[1])
    .filter((t, i, all) => !shown.has(t) && all.indexOf(t) === i)
    .map((t) => [t, tableRows(xml, t).length] as const)
    .filter(([, n]) => n > 0);
  if (others.length) {
    out.push(
      "## Other tables",
      "",
      "| Table | Rows |",
      "| --- | --- |",
      ...others.map(([t, n]) => `| ${t} | ${n} |`),
      "",
    );
  }

  return { title: "Neptune DXP application export", summary: out.join("\n").trim() };
}

xmlSummarizers.push(summarizeNeptuneApp);
