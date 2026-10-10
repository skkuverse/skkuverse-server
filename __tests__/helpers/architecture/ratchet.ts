/**
 * The ratchet behind every architecture rule (docs/decisions/0010-server-architecture.md).
 *
 * A rule returns its violations as strings. The harness compares them with the
 * rule's allowlist, `__tests__/architecture/allowlists/<rule>.json`: a sorted
 * JSON array of the violations that existed when the rule was introduced. It
 * fails on a violation that is not listed (new code must follow the rule) and
 * on a listed entry that no longer violates (delete it, so the list only
 * shrinks). The failure message prints the regenerated list.
 */
import fs from "fs";
import path from "path";

export const ROOT = path.join(__dirname, "../../..");
export const ALLOWLIST_DIR = path.join(ROOT, "__tests__/architecture/allowlists");

export interface RatchetResult {
  /** Violations missing from the allowlist. */
  added: string[];
  /** Allowlisted entries that no longer violate. */
  fixed: string[];
}

export function compareWithAllowlist(
  violations: readonly string[],
  allowlist: readonly string[],
): RatchetResult {
  const found = new Set(violations);
  const listed = new Set(allowlist);
  return {
    added: [...found].filter((v) => !listed.has(v)).sort(),
    fixed: [...listed].filter((v) => !found.has(v)).sort(),
  };
}

/** A missing file is an empty allowlist. An unsorted or duplicated one is an error. */
export function readAllowlist(rule: string, dir: string = ALLOWLIST_DIR): string[] {
  const file = path.join(dir, `${rule}.json`);
  if (!fs.existsSync(file)) return [];
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed) || !parsed.every((v): v is string => typeof v === "string")) {
    throw new Error(`${path.relative(ROOT, file)} must be a JSON array of strings`);
  }
  const canonical = [...new Set(parsed)].sort();
  if (canonical.join("\n") !== parsed.join("\n")) {
    throw new Error(
      `${path.relative(ROOT, file)} must be sorted and free of duplicates:\n${formatList(canonical)}`,
    );
  }
  return parsed;
}

export function formatList(entries: readonly string[]): string {
  return `${JSON.stringify([...new Set(entries)].sort(), null, 2)}\n`;
}

export function ratchetMessage(
  rule: string,
  result: RatchetResult,
  violations: readonly string[],
): string {
  const file = `__tests__/architecture/allowlists/${rule}.json`;
  const lines = [`[architecture:${rule}]`];
  if (result.added.length > 0) {
    lines.push(
      "New violations. Fix the code; the allowlist only records what existed before the rule:",
      ...result.added.map((v) => `  - ${v}`),
    );
  }
  if (result.fixed.length > 0) {
    lines.push(
      `No longer violating. Delete these from ${file}:`,
      ...result.fixed.map((v) => `  - ${v}`),
    );
  }
  const remaining = violations.filter((v) => !result.added.includes(v));
  lines.push(`Allowlist after removing the fixed entries (${file}):`, formatList(remaining));
  return lines.join("\n");
}

/** Throws unless `violations` equals the rule's allowlist exactly. */
export function expectAllowlisted(
  rule: string,
  violations: readonly string[],
  dir: string = ALLOWLIST_DIR,
): void {
  const result = compareWithAllowlist(violations, readAllowlist(rule, dir));
  if (result.added.length > 0 || result.fixed.length > 0) {
    throw new Error(ratchetMessage(rule, result, violations));
  }
}
