import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ANIMATED_GIF_HANDLING,
  Budget,
  classifyByName,
  DISABLED_HANDLING,
  extractAny,
  HANDLING,
  isAnimatedGif,
  kindEnabled,
  MIN_IMAGE_DIMENSION,
  mergeTextBlocks,
  toSupportedImage,
  UNTRUSTED_NOTICE,
  willAnalyse,
} from "../extract.js";
import { errorPayload, type FreshdeskResult, fd, parseLinkHeader } from "../freshdesk.js";
import { text, tool } from "../util.js";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

function envInt(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Per file download limit. */
const MAX_FILE_BYTES = envInt("FRESHDESK_MAX_ATTACHMENT_BYTES", 25 * 1024 * 1024);
/** Total bytes returned by a single get_ticket_inline_images call. */
const MAX_TOTAL_BYTES = envInt("FRESHDESK_MAX_TOTAL_ATTACHMENT_BYTES", 20 * 1024 * 1024);
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const MAX_CONVERSATION_PAGES = 20;

/**
 * Hosts we are allowed to download from. Attachment and inline image URLs are
 * pre-signed (CloudFront / S3), so no Freshdesk credentials are ever sent.
 * The allowlist prevents SSRF through customer supplied <img> tags.
 */
const ALLOWED_HOSTS = (process.env.FRESHDESK_ATTACHMENT_HOSTS ?? "freshdesk.com,freshworks.com")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const tenantHost = (process.env.FRESHDESK_DOMAIN ?? "").toLowerCase();
if (tenantHost && !ALLOWED_HOSTS.includes(tenantHost)) ALLOWED_HOSTS.push(tenantHost);

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface FdAttachment {
  id: number;
  name?: string;
  content_type?: string;
  size?: number;
  attachment_url?: string;
  created_at?: string;
  scan_state?: number;
}

interface FdConversation {
  id: number;
  body?: string;
  private?: boolean;
  incoming?: boolean;
  source?: number;
  created_at?: string;
  attachments?: FdAttachment[];
}

interface FdTicket {
  id: number;
  description?: string;
  created_at?: string;
  attachments?: FdAttachment[];
}

type Content = CallToolResult["content"][number];

/* -------------------------------------------------------------------------- */
/* Freshdesk reads                                                            */
/* -------------------------------------------------------------------------- */

async function fetchTicket(
  ticketId: number,
): Promise<{ ok: true; ticket: FdTicket } | { ok: false; res: FreshdeskResult }> {
  const res = await fd.get<FdTicket>(`/tickets/${ticketId}`);
  return res.ok ? { ok: true, ticket: res.data } : { ok: false, res };
}

/** Reads every conversation page, so attachments in late replies are not missed. */
async function fetchAllConversations(
  ticketId: number,
): Promise<{ ok: true; conversations: FdConversation[] } | { ok: false; res: FreshdeskResult }> {
  const conversations: FdConversation[] = [];
  let page: number | null = 1;
  let fetched = 0;
  while (page !== null && fetched < MAX_CONVERSATION_PAGES) {
    const res: FreshdeskResult = await fd.get(`/tickets/${ticketId}/conversations`, {
      page,
      per_page: 100,
    });
    if (!res.ok) return { ok: false, res };
    if (Array.isArray(res.data)) conversations.push(...(res.data as FdConversation[]));
    fetched++;
    page = parseLinkHeader(res.headers.get("link")).next;
  }
  return { ok: true, conversations };
}

/** Whether a GIF is animated is only known after download, so the listing says so. */
const GIF_LIST_HANDLING = "image if static; if animated, treated as video and not analysed";

function isGifName(name: string, contentType: string): boolean {
  return /\.gif$/i.test(name) || contentType.toLowerCase() === "image/gif";
}

type AttachmentHit = { att: FdAttachment; origin: string; conversation_id?: number };

/** All attachments on a ticket and its conversations, plus a count of inline images. */
async function collectAttachments(
  ticketId: number,
): Promise<
  { ok: true; items: AttachmentHit[]; inlineImages: number } | { ok: false; error: unknown }
> {
  const t = await fetchTicket(ticketId);
  if (!t.ok) return { ok: false, error: errorPayload("Failed to fetch ticket", t.res) };
  const items: AttachmentHit[] = (t.ticket.attachments ?? []).map((att) => ({
    att,
    origin: "ticket description",
  }));
  let inlineImages = extractImgSrcs(t.ticket.description).length;
  const conv = await fetchAllConversations(ticketId);
  if (!conv.ok)
    return { ok: false, error: errorPayload("Failed to fetch conversations", conv.res) };
  for (const c of conv.conversations) {
    inlineImages += extractImgSrcs(c.body).length;
    for (const att of c.attachments ?? [])
      items.push({ att, origin: conversationOrigin(c), conversation_id: c.id });
  }
  return { ok: true, items, inlineImages };
}

/* -------------------------------------------------------------------------- */
/* Safe download                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Extra hosts accepted only for attachment_url values returned by the Freshdesk
 * API itself (never for <img src> found in message bodies, which a customer can
 * control). Older attachments are served as pre-signed S3 URLs, for example
 * https://s3.amazonaws.com/cdn.freshdesk.com/data/helpdesk/attachments/...
 */
const API_ATTACHMENT_EXTRA_HOSTS = ["amazonaws.com"];

function hostAllowed(url: URL, trusted: boolean): boolean {
  const host = url.hostname.toLowerCase();
  const hosts = trusted ? [...ALLOWED_HOSTS, ...API_ATTACHMENT_EXTRA_HOSTS] : ALLOWED_HOSTS;
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

function checkUrl(
  raw: string,
  trusted: boolean,
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "only https URLs are downloaded" };
  if (!hostAllowed(url, trusted)) return { ok: false, reason: `host not allowed: ${url.hostname}` };
  return { ok: true, url };
}

type Download =
  | { ok: true; bytes: Buffer; contentType: string | null }
  | { ok: false; reason: string };

/**
 * Downloads a pre-signed URL without any Freshdesk credentials.
 * Redirects are followed manually so every hop is checked against the allowlist,
 * and the body is streamed so oversized files are aborted early.
 */
async function download(raw: string, maxBytes: number, trusted = false): Promise<Download> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkUrl(current, trusted);
    if (!checked.ok) return checked;

    let res: Response;
    try {
      res = await fetch(checked.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch (e) {
      return { ok: false, reason: `download failed: ${(e as Error).message}` };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, reason: `redirect without location (HTTP ${res.status})` };
      current = new URL(location, checked.url).toString();
      continue;
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: `HTTP ${res.status}${res.status === 403 ? " (signed URL may have expired)" : ""}`,
      };
    }

    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      await res.body?.cancel();
      return { ok: false, reason: `file too large (${declared} bytes, limit ${maxBytes})` };
    }

    const chunks: Buffer[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return { ok: false, reason: `file too large (over ${maxBytes} bytes)` };
        }
        chunks.push(Buffer.from(value));
      }
    }
    return { ok: true, bytes: Buffer.concat(chunks), contentType: res.headers.get("content-type") };
  }
  return { ok: false, reason: "too many redirects" };
}

/** Strips the signature query string so signed URLs are not echoed back. */
function displayUrl(raw: string): string {
  if (raw.startsWith("data:")) return `${raw.slice(0, 30)}...`;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return raw.slice(0, 200);
    return `${u.origin}${u.pathname}`;
  } catch {
    return raw.slice(0, 200);
  }
}

/* -------------------------------------------------------------------------- */
/* Image helpers                                                              */
/* -------------------------------------------------------------------------- */

function sniffImageType(b: Buffer): string | null {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (
    b.length >= 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

/** Reads width and height from the image header. Returns null when unknown. */
function imageSize(b: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && b.length >= 24) {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (mime === "image/gif" && b.length >= 10) {
      return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    }
    if (mime === "image/bmp" && b.length >= 26) {
      return { width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = b[i + 1];
        const isSof =
          marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    if (mime === "image/webp" && b.length >= 30) {
      const chunk = b.toString("ascii", 12, 16);
      if (chunk === "VP8X")
        return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (chunk === "VP8 ")
        return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    // Malformed header: treat size as unknown.
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number.parseInt(d, 10)));
}

/** Extracts every <img src> value from an HTML fragment, in document order. */
export function extractImgSrcs(html: string | undefined): string[] {
  if (!html) return [];
  const out: string[] = [];
  const re = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const src = decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim());
    if (src) out.push(src);
  }
  return out;
}

function decodeDataUri(src: string): { bytes: Buffer; mime: string } | null {
  const m = src.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return null;
  const mime = (m[1] ?? "").toLowerCase();
  const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  return { bytes, mime };
}

function conversationOrigin(c: FdConversation): string {
  if (c.private) return "private note";
  if (c.source === 2) return "public note";
  return c.incoming ? "customer reply" : "agent reply";
}

/* -------------------------------------------------------------------------- */
/* Tools                                                                      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Reading one attachment (shared by get_ticket_attachment(s))                 */
/* -------------------------------------------------------------------------- */

const LIMIT_PARAMS = {
  max_text_chars: z
    .number()
    .int()
    .min(1000)
    .max(500_000)
    .optional()
    .default(60_000)
    .describe("Maximum characters of extracted text returned in total (default 60000)."),
  max_pages: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe("Maximum PDF pages rendered as images in total (default 5)."),
  max_images: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .default(10)
    .describe(
      "Maximum images returned in total, including PDF pages and images inside documents or archives (default 10).",
    ),
  har_raw: z
    .boolean()
    .optional()
    .default(false)
    .describe("For HAR files, return the raw JSON instead of the request summary."),
};

function budgetFrom(l: {
  max_text_chars: number;
  max_pages: number;
  max_images: number;
  har_raw: boolean;
}): Budget {
  return new Budget({
    maxTextChars: l.max_text_chars,
    maxPages: l.max_pages,
    maxImages: l.max_images,
    harRaw: l.har_raw,
  });
}

/**
 * Downloads and extracts one attachment within the given budget. Never throws:
 * skipped and failed files return a header explaining why and no content.
 */
async function readAttachment(
  ticketId: number,
  hit: AttachmentHit,
  budget: Budget,
): Promise<{ header: Record<string, unknown>; content: Content[] }> {
  const { att } = hit;
  const name = att.name ?? `attachment-${att.id}`;
  const kindByName = classifyByName(name, att.content_type ?? "");
  const meta = {
    ticket_id: ticketId,
    attachment_id: att.id,
    name,
    content_type: att.content_type ?? null,
    size: att.size ?? null,
    origin: hit.origin,
    conversation_id: hit.conversation_id ?? null,
    scan_state: att.scan_state ?? null,
  };
  const none = (extra: Record<string, unknown>) => ({ header: { ...meta, ...extra }, content: [] });

  if (!kindEnabled(kindByName)) {
    return none({
      handling: DISABLED_HANDLING,
      analysed: false,
      reason: "This file type is disabled by the server configuration. It was not downloaded.",
    });
  }
  if (!willAnalyse(kindByName)) {
    return none({
      handling: HANDLING[kindByName],
      analysed: false,
      reason: "This file type cannot be read. It was not downloaded.",
    });
  }
  if (!att.attachment_url) return none({ error: "Attachment has no download URL" });
  if (att.size && att.size > MAX_FILE_BYTES) {
    return none({
      error: `File too large (${att.size} bytes, limit ${MAX_FILE_BYTES}). Raise FRESHDESK_MAX_ATTACHMENT_BYTES to allow it.`,
    });
  }

  // attachment_url comes from the Freshdesk API, so S3 hosts are accepted here.
  const dl = await download(att.attachment_url, MAX_FILE_BYTES, true);
  if (!dl.ok) return none({ error: `Download failed: ${dl.reason}` });

  const out = await extractAny(dl.bytes, name, att.content_type ?? "", budget);
  const header = {
    ...meta,
    downloaded_bytes: dl.bytes.length,
    detected_kind: out.kind,
    handling: out.handling ?? HANDLING[out.kind],
    truncated: budget.truncated,
    notes: out.notes,
    ...(out.content.length ? {} : { analysed: false }),
  };
  return { header, content: out.content };
}

export function registerAttachmentTools(server: McpServer) {
  tool(
    server,
    "list_ticket_attachments",
    "List every file attached to one or more tickets (description and all conversations) without downloading them: id, name, type, size, origin and how get_ticket_attachment will handle it. Videos, audio and executables are flagged as not analysed. Also counts inline images pasted in message bodies. Use name_contains to find a file across several tickets.",
    {
      ticket_ids: z.array(z.number().int()).min(1).max(25),
      name_contains: z
        .string()
        .optional()
        .describe("Only return attachments whose file name contains this text (case-insensitive)."),
    },
    async ({ ticket_ids, name_contains }): Promise<CallToolResult> => {
      const filter = name_contains?.toLowerCase();
      const results = [];
      for (const ticket_id of ticket_ids) {
        const found = await collectAttachments(ticket_id);
        if (!found.ok) {
          results.push({ ticket_id, error: found.error });
          continue;
        }
        const attachments = found.items
          .filter((c) => !filter || (c.att.name ?? "").toLowerCase().includes(filter))
          .map((c) => {
            const kind = classifyByName(c.att.name ?? "", c.att.content_type ?? "");
            return {
              id: c.att.id,
              name: c.att.name,
              content_type: c.att.content_type,
              size: c.att.size,
              created_at: c.att.created_at,
              origin: c.origin,
              conversation_id: c.conversation_id ?? null,
              handling: !kindEnabled(kind)
                ? DISABLED_HANDLING
                : isGifName(c.att.name ?? "", c.att.content_type ?? "")
                  ? GIF_LIST_HANDLING
                  : HANDLING[kind],
              analysed: willAnalyse(kind),
            };
          });
        const counts: Record<string, number> = {};
        for (const a of attachments) counts[a.handling] = (counts[a.handling] ?? 0) + 1;
        results.push({
          ticket_id,
          attachment_count: attachments.length,
          by_handling: counts,
          inline_image_count: filter ? undefined : found.inlineImages,
          attachments,
        });
      }
      return text(ticket_ids.length === 1 ? results[0] : { tickets: results });
    },
  );

  tool(
    server,
    "get_ticket_attachment",
    "Read one file attached to a ticket or any of its conversations and return what the model can use: text (PDF page by page, Word as Markdown, Excel/CSV as tables, PowerPoint slide text, emails with headers and attachment list, JSON, XML, logs), a request summary for HAR files, and images (PNG/JPEG/GIF/WebP, other formats converted, PDF pages with images or without text rendered). ZIP archives are listed and their files processed with the same rules. Videos, audio, executables and animated GIFs are not analysed. Large outputs are truncated with a clear marker. Attachment ids come from list_ticket_attachments. To read several attachments in one call, use get_ticket_attachments.",
    { ticket_id: z.number().int(), attachment_id: z.number().int(), ...LIMIT_PARAMS },
    async ({ ticket_id, attachment_id, ...limits }): Promise<CallToolResult> => {
      // Re-read the ticket every time: attachment URLs are signed and expire.
      const found = await collectAttachments(ticket_id);
      if (!found.ok) return text({ error: found.error });
      const hit = found.items.find((c) => c.att.id === attachment_id);
      if (!hit) {
        return text({
          error: `Attachment ${attachment_id} not found on ticket ${ticket_id}`,
          available_attachments: found.items.map((c) => ({
            id: c.att.id,
            name: c.att.name,
            origin: c.origin,
          })),
        });
      }
      const budget = budgetFrom(limits);
      const { header, content } = await readAttachment(ticket_id, hit, budget);
      if (content.length === 0) return text(header);
      return {
        content: mergeTextBlocks([
          { type: "text", text: JSON.stringify(header, null, 2) },
          { type: "text", text: UNTRUSTED_NOTICE },
          ...content,
        ]),
      };
    },
  );

  tool(
    server,
    "get_ticket_attachments",
    "Read several (or all) attachments of a ticket in one call, with the same rules as get_ticket_attachment and one output budget shared by all files. Starts with a JSON summary of every attachment (handling, status), then each file under a '===== Attachment N of M =====' marker. Files that cannot be analysed are not downloaded. When the budget runs out, the remaining files are listed as skipped so they can be read individually.",
    {
      ticket_id: z.number().int(),
      attachment_ids: z
        .array(z.number().int())
        .min(1)
        .max(50)
        .optional()
        .describe("Attachments to read. Omit to read every attachment of the ticket."),
      ...LIMIT_PARAMS,
      max_text_chars: LIMIT_PARAMS.max_text_chars.default(100_000),
    },
    async ({ ticket_id, attachment_ids, ...limits }): Promise<CallToolResult> => {
      const found = await collectAttachments(ticket_id);
      if (!found.ok) return text({ error: found.error });
      const missing = (attachment_ids ?? []).filter(
        (id) => !found.items.some((c) => c.att.id === id),
      );
      const selected = attachment_ids
        ? found.items.filter((c) => attachment_ids.includes(c.att.id))
        : found.items;

      const budget = budgetFrom(limits);
      const summary: Record<string, unknown>[] = [];
      const body: Content[] = [];
      for (let i = 0; i < selected.length; i++) {
        const hit = selected[i];
        const exhausted = budget.chars <= 0 && budget.images <= 0;
        const kind = classifyByName(hit.att.name ?? "", hit.att.content_type ?? "");
        if (exhausted && willAnalyse(kind)) {
          budget.truncated = true;
          summary.push({
            id: hit.att.id,
            name: hit.att.name,
            status: "skipped: output limits reached, read it with get_ticket_attachment",
          });
          continue;
        }
        const { header, content } = await readAttachment(ticket_id, hit, budget);
        const firstNote = Array.isArray(header.notes) ? header.notes[0] : undefined;
        const status = header.error
          ? `error: ${header.error}`
          : content.length
            ? "read"
            : String(header.reason ?? firstNote ?? "not analysed");
        summary.push({
          id: hit.att.id,
          name: header.name,
          origin: header.origin,
          conversation_id: header.conversation_id,
          handling: header.handling,
          status,
          ...(Array.isArray(header.notes) && header.notes.length ? { notes: header.notes } : {}),
        });
        if (content.length) {
          body.push(
            {
              type: "text",
              text: `===== Attachment ${i + 1} of ${selected.length}: ${header.name} (id ${hit.att.id}, ${header.origin}${hit.conversation_id ? `, conversation ${hit.conversation_id}` : ""}) =====\nHandling: ${header.handling}`,
            },
            ...content,
          );
        }
      }
      const overview = {
        ticket_id,
        attachments: selected.length,
        read: summary.filter((s) => s.status === "read").length,
        truncated: budget.truncated,
        ...(missing.length ? { not_found: missing } : {}),
        files: summary,
      };
      return {
        content: mergeTextBlocks([
          { type: "text", text: JSON.stringify(overview, null, 2) },
          ...(body.length ? [{ type: "text" as const, text: UNTRUSTED_NOTICE }, ...body] : []),
        ]),
      };
    },
  );

  tool(
    server,
    "get_ticket_inline_images",
    "Return the images pasted inline into a ticket description and, optionally, into its conversation bodies (screenshots that are NOT listed in the attachments array). Each image is labeled with its origin. The first content item is a JSON summary of what was found, returned and skipped.",
    {
      ticket_id: z.number().int(),
      include_conversations: z.boolean().optional().default(true),
      max_images: z.number().int().min(1).max(50).optional().default(10),
      min_dimension: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(MIN_IMAGE_DIMENSION)
        .describe(
          `Skip images whose width AND height are both below this many pixels (signatures, logos, icons). 0 disables the filter. Default ${MIN_IMAGE_DIMENSION} (FRESHDESK_MIN_IMAGE_DIMENSION).`,
        ),
    },
    async ({
      ticket_id,
      include_conversations,
      max_images,
      min_dimension,
    }): Promise<CallToolResult> => {
      if (!kindEnabled("image"))
        return text({ ticket_id, error: "Images are disabled by FRESHDESK_ATTACHMENT_TYPES" });
      const t = await fetchTicket(ticket_id);
      if (!t.ok) return text(errorPayload("Failed to fetch ticket", t.res));

      const sources: {
        src: string;
        origin: string;
        conversation_id?: number;
        created_at?: string;
      }[] = extractImgSrcs(t.ticket.description).map((src) => ({
        src,
        origin: "description",
        created_at: t.ticket.created_at,
      }));

      if (include_conversations) {
        const conv = await fetchAllConversations(ticket_id);
        if (!conv.ok) return text(errorPayload("Failed to fetch conversations", conv.res));
        for (const c of conv.conversations) {
          for (const src of extractImgSrcs(c.body)) {
            sources.push({
              src,
              origin: conversationOrigin(c),
              conversation_id: c.id,
              created_at: c.created_at,
            });
          }
        }
      }

      const skipped: { src: string; origin: string; conversation_id?: number; reason: string }[] =
        [];
      const returned: Record<string, unknown>[] = [];
      let imageBlocks = 0;
      const images: Content[] = [];
      const seenUrls = new Set<string>();
      const seenHashes = new Set<string>();
      let totalBytes = 0;

      for (const s of sources) {
        const skip = (reason: string) =>
          skipped.push({
            src: displayUrl(s.src),
            origin: s.origin,
            conversation_id: s.conversation_id,
            reason,
          });

        if (imageBlocks >= max_images) {
          skip("max_images reached");
          continue;
        }
        if (s.src.toLowerCase().startsWith("cid:")) {
          skip("cid reference (email image that Freshdesk did not convert)");
          continue;
        }

        // Exact URL match only. Some tenants serve every inline image from the same
        // path (for example attachment.freshdesk.com/inline/attachment?token=...),
        // so the query string identifies the image. Re-signed copies of the same
        // image are caught by the content hash below.
        if (seenUrls.has(s.src)) {
          skip("duplicate (same image already returned)");
          continue;
        }
        seenUrls.add(s.src);

        let bytes: Buffer;
        if (s.src.startsWith("data:")) {
          const d = decodeDataUri(s.src);
          if (!d) {
            skip("malformed data URI");
            continue;
          }
          if (d.bytes.length > MAX_FILE_BYTES) {
            skip(`image too large (${d.bytes.length} bytes)`);
            continue;
          }
          bytes = d.bytes;
        } else {
          const dl = await download(s.src, MAX_FILE_BYTES);
          if (!dl.ok) {
            skip(dl.reason);
            continue;
          }
          bytes = dl.bytes;
        }

        let mime = sniffImageType(bytes);
        if (!mime) {
          // BMP, TIFF and HEIC are converted. Anything else is not an image we can show.
          const converted = await toSupportedImage(bytes);
          if (!converted) {
            skip("not a supported image format");
            continue;
          }
          bytes = converted.data;
          mime = converted.mimeType;
        }

        const hash = createHash("sha256").update(bytes).digest("hex");
        if (seenHashes.has(hash)) {
          skip("duplicate (identical content, e.g. quoted reply)");
          continue;
        }
        seenHashes.add(hash);

        const size = imageSize(bytes, mime);
        if (
          min_dimension > 0 &&
          size &&
          size.width < min_dimension &&
          size.height < min_dimension
        ) {
          skip(`too small (${size.width}x${size.height}), likely a logo or signature`);
          continue;
        }

        // Animated GIFs (screen recordings) are handled like videos: not analysed.
        if (mime === "image/gif" && isAnimatedGif(bytes)) {
          skip(ANIMATED_GIF_HANDLING);
          continue;
        }

        // Shrink very large screenshots so they fit the model's image limits.
        const fitted = await toSupportedImage(bytes);
        if (fitted) {
          bytes = fitted.data;
          mime = fitted.mimeType;
        }

        if (totalBytes + bytes.length > MAX_TOTAL_BYTES) {
          skip(`total size limit reached (${MAX_TOTAL_BYTES} bytes per call)`);
          continue;
        }
        totalBytes += bytes.length;

        const index = returned.length + 1;
        const info = {
          index,
          origin: s.origin,
          conversation_id: s.conversation_id ?? null,
          created_at: s.created_at ?? null,
          src: displayUrl(s.src),
          mime_type: mime,
          bytes: bytes.length,
          width: size?.width ?? null,
          height: size?.height ?? null,
        };
        const label = `Image ${index}: ${s.origin}${s.conversation_id ? ` (conversation ${s.conversation_id})` : ""}${s.created_at ? `, ${s.created_at}` : ""}`;
        returned.push(info);
        images.push({ type: "text", text: label });
        images.push({ type: "image", data: bytes.toString("base64"), mimeType: mime });
        imageBlocks++;
      }

      const summary = {
        ticket_id,
        found: sources.length,
        returned: returned.length,
        skipped: skipped.length,
        images: returned,
        skipped_details: skipped,
      };
      return {
        content: mergeTextBlocks([
          { type: "text", text: JSON.stringify(summary, null, 2) },
          ...images,
        ]),
      };
    },
  );
}
