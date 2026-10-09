/** User input as a literal pattern: every regex metacharacter is escaped. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
