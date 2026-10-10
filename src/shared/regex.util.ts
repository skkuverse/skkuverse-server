/** User input as a literal pattern: every regex metacharacter is escaped. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The first `count` capture groups of `pattern` in `text`, or null when it does not match. A match
 * without one of them throws: the patterns passed here make every group they read required.
 */
export function captureGroups(text: string, pattern: RegExp, count: 1): [string] | null;
export function captureGroups(text: string, pattern: RegExp, count: 2): [string, string] | null;
export function captureGroups(text: string, pattern: RegExp, count: number): string[] | null {
  if (pattern.global || pattern.sticky) {
    throw new Error(`${String(pattern)} keeps lastIndex between calls; captureGroups takes a pattern without g or y`);
  }
  const match = pattern.exec(text);
  if (!match) return null;
  const groups = match.slice(1, count + 1);
  if (groups.length !== count || groups.some((group) => group === undefined)) {
    throw new Error(`${String(pattern)} matched without ${count} capture groups`);
  }
  return groups;
}
