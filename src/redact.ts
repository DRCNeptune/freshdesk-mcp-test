/**
 * Detection (always) and masking (with FRESHDESK_REDACT=1) of sensitive data in text
 * extracted from attachments: IBANs, payment cards, SWIFT/BIC codes, credentials in
 * key/value form, Authorization headers, JWTs, private keys and long secret tokens
 * such as licence keys. Personal names and other free text cannot be detected
 * reliably, and images (scans, screenshots) are never masked.
 */

export const REDACT_ENABLED = /^(1|true|yes|on)$/i.test(process.env.FRESHDESK_REDACT ?? "");

/** Keeps a short prefix and suffix so the value can still be recognised. */
function mask(value: string, keep = 4): string {
  if (value.length <= keep * 2 + 4) return "[REDACTED]";
  return `${value.slice(0, keep)}…[REDACTED ${value.length - keep * 2} chars]…${value.slice(-keep)}`;
}

function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

interface Rule {
  label: string;
  pattern: RegExp;
  /** Returns the replacement, or null to leave the match untouched (false positive). */
  replace: (match: string, ...groups: string[]) => string | null;
}

const RULES: Rule[] = [
  {
    label: "private key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => "[REDACTED PRIVATE KEY]",
  },
  {
    label: "authorization header",
    pattern:
      /\b(Authorization\s*[:=]\s*"?(?:Basic|Bearer|Digest|NTLM|Negotiate)\s+)([A-Za-z0-9+/=._~-]{8,})/gi,
    replace: (_m, prefix, token) => `${prefix}${mask(token)}`,
  },
  {
    label: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: (m) => mask(m, 6),
  },
  {
    label: "credential",
    // password: x, "client_secret":"x", api-key=x, ...
    pattern:
      /\b((?:pass(?:word|wd)?|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token)"?\s*[:=]\s*"?)([^\s",;<]{3,})/gi,
    replace: (_m, prefix) => `${prefix}[REDACTED]`,
  },
  {
    label: "IBAN",
    pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g,
    replace: (m) => (ibanValid(m) ? mask(m.replace(/\s+/g, ""), 4) : null),
  },
  {
    label: "SWIFT/BIC",
    pattern:
      /\b((?:SWIFT|BIC)(?:\s*\/\s*(?:SWIFT|BIC))?(?:\s*code)?\s*[:.]?\s*)([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi,
    replace: (_m, prefix, code) => `${prefix}${mask(code, 2)}`,
  },
  {
    label: "payment card",
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    replace: (m) => (luhnValid(m) ? mask(m.replace(/\D/g, ""), 4) : null),
  },
  {
    label: "secret token or licence key",
    // Long unbroken runs mixing letters and digits (licence keys, API tokens).
    pattern: /[A-Za-z0-9+/=_-]{64,}/g,
    replace: (m) => (/[A-Za-z]/.test(m) && /\d/.test(m) ? mask(m, 6) : null),
  },
];

export interface ScanResult {
  text: string;
  /** Kinds of sensitive data found, e.g. ["IBAN", "secret token or licence key"]. */
  found: string[];
}

/** Finds sensitive data in a text and, when masking is on, replaces it. */
export function scanSensitive(text: string, redact = REDACT_ENABLED): ScanResult {
  const found = new Set<string>();
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (...args) => {
      const match = args[0] as string;
      const groups = args.slice(1, -2).map((g) => (typeof g === "string" ? g : ""));
      const replacement = rule.replace(match, ...groups);
      if (replacement === null) return match;
      found.add(rule.label);
      return redact ? replacement : match;
    });
  }
  return { text: out, found: [...found] };
}
