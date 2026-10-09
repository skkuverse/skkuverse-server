/**
 * Notice search helpers — pure functions, no DB.
 *
 * validateQ normalizes a value from req.query.q into either a trimmed search
 * string or null; the route layer treats null as "no search clause". It NEVER
 * throws, so the route can compose the query unconditionally with `if (q)`.
 * Escaping the string into a literal pattern is escapeRegex
 * (shared/regex.util.ts).
 *
 * Length is measured in Unicode codepoints (`[...str].length`), not UTF-16
 * code units (`str.length`). A naive `.length` cap allows e.g. 50 emoji
 * (each is two code units) and rejects 100 ASCII chars at the same
 * threshold — confusing for users in CJK / emoji-heavy queries.
 */
const MAX_QUERY_CODEPOINTS = 100;

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const cp = s.charCodeAt(i);
    if (cp < 32 || cp === 127) return true;
  }
  return false;
}

function validateQ(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (hasControlChar(trimmed)) return null;
  // Codepoint count — handles surrogate pairs correctly.
  if ([...trimmed].length > MAX_QUERY_CODEPOINTS) return null;
  return trimmed;
}

export { validateQ, MAX_QUERY_CODEPOINTS };
