export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
