import { z } from "zod";

// LLMs don't reliably return numeric JSON fields as numbers: reps come back as
// "10-12" (range), "12 each side", quantities as "1 1/2", calories as
// "~1,200 kcal", durations as "30 seconds" or "1 hour 30 min". Instead of
// failing validation on the whole response, extract a usable number per field
// kind. null and unparseable strings become undefined so optional fields
// degrade gracefully; required fields still fail cleanly.

// "1,200" → "1200" (only strips commas used as thousands separators)
function stripThousands(text: string): string {
  return text.replace(/(\d),(?=\d{3}\b)/g, "$1");
}

function extractNumber(val: unknown): unknown {
  if (val === null) return undefined;
  if (typeof val !== "string") return val;
  const text = stripThousands(val.trim());
  // Whole-string (mixed) fractions only: "1/2" → 0.5, "1 1/2" → 1.5.
  // Unanchored matching would corrupt rep schemes like "21/15/9".
  const fraction = text.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/);
  if (fraction && Number(fraction[3]) !== 0) {
    return Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3]);
  }
  // No leading "-": these fields are never legitimately negative, and text
  // like "sub-10" must not parse as -10. Allow bare decimals (".5").
  const num = text.match(/\d+(?:\.\d+)?|\.\d+/);
  return num ? Number(num[0]) : undefined;
}

const HOURS_RE = /(\d+(?:\.\d+)?|\.\d+)\s*(?:hours?|hrs?)\b/i;
const MINUTES_RE = /(\d+(?:\.\d+)?|\.\d+)\s*(?:minutes?|mins?)\b/i;
const SECONDS_RE = /(\d+(?:\.\d+)?|\.\d+)\s*(?:seconds?|secs?)\b/i;
const TIME_UNIT_RE = /\b(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i;
// "3x10" / "4 x 12" set-scheme strings: group 1 is sets, group 2 is reps
const SCHEME_RE = /^(\d+)\s*[x×]\s*(\d+)$/i;

// A duration string in the given unit. "1 hour 30 min" → 90 (minutes) or
// 5400 (seconds); a bare number is assumed to already be in the target unit.
function extractDuration(val: unknown, unit: "minutes" | "seconds"): unknown {
  if (val === null) return undefined;
  if (typeof val !== "string") return val;
  const text = stripThousands(val.trim());
  const h = text.match(HOURS_RE);
  const m = text.match(MINUTES_RE);
  const s = text.match(SECONDS_RE);
  if (h || m || s) {
    const minutes =
      (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0) + (s ? Number(s[1]) / 60 : 0);
    return unit === "minutes" ? minutes : Math.round(minutes * 60);
  }
  const n = extractNumber(text);
  return unit === "seconds" && typeof n === "number" ? Math.round(n) : n;
}

// A count (sets/reps). Time-unit strings are durations that landed in the
// wrong field ("60 seconds" as reps) — drop them rather than store 60 reps.
function extractCount(val: unknown, schemeGroup: 1 | 2): unknown {
  if (typeof val === "string") {
    if (TIME_UNIT_RE.test(val)) return undefined;
    const scheme = val.trim().match(SCHEME_RE);
    if (scheme) return Number(scheme[schemeGroup]);
  }
  const n = extractNumber(val);
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : n;
}

export function llmNumber<T extends z.ZodType>(schema: T) {
  return z.preprocess(extractNumber, schema);
}

// Integer count where an NxM scheme means this field comes first (sets)
export function llmInt<T extends z.ZodType>(schema: T) {
  return z.preprocess((val) => extractCount(val, 1), schema);
}

// Reps: in an NxM scheme the rep count is the second number
export function llmReps<T extends z.ZodType>(schema: T) {
  return z.preprocess((val) => extractCount(val, 2), schema);
}

export function llmMinutes<T extends z.ZodType>(schema: T) {
  return z.preprocess((val) => extractDuration(val, "minutes"), schema);
}

export function llmSeconds<T extends z.ZodType>(schema: T) {
  return z.preprocess((val) => extractDuration(val, "seconds"), schema);
}

// String array where the LLM may send null or omit the key entirely
export function llmStrings() {
  return z.preprocess((val) => val ?? [], z.array(z.string()));
}

// String where the LLM may send null or omit the key
export function llmString(fallback: string) {
  return z.preprocess((val) => val ?? fallback, z.string());
}
