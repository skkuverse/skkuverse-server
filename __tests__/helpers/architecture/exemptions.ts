/**
 * A reasoned exemption: `__tests__/architecture/exemptions/<rule>.json`, an
 * object from a file to why the rule does not apply to it. An allowlist
 * (ratchet.ts) records debt in modules not yet migrated and only shrinks, so
 * a migrated scope carries none (migrated-scopes.test.ts). An exemption is a
 * decision that holds in a migrated scope, so it lives apart from the
 * allowlists and every entry states its reason, which review reads.
 *
 * The harness fails on a violation that is not exempt, on an exempt file that
 * no longer violates (delete the entry), and on a reason shorter than
 * MIN_REASON_LENGTH or of fewer than MIN_REASON_WORDS words.
 */
import fs from "fs";
import path from "path";
import { ROOT } from "./ratchet";

export const EXEMPTIONS_DIR = path.join(ROOT, "__tests__/architecture/exemptions");
export const MIN_REASON_LENGTH = 40;
export const MIN_REASON_WORDS = 6;

/** A missing file is no exemption. Keys must be sorted; a value that is not a full reason is an error. */
export function readExemptions(rule: string, dir: string = EXEMPTIONS_DIR): Map<string, string> {
  const file = path.join(dir, `${rule}.json`);
  if (!fs.existsSync(file)) return new Map();
  const where = path.relative(ROOT, file);
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${where} must be a JSON object from a path to its reason`);
  }
  const entries = Object.entries(parsed);
  const keys = entries.map(([key]) => key);
  if (keys.join("\n") !== [...keys].sort().join("\n")) throw new Error(`${where} must list its paths sorted`);
  for (const [key, reason] of entries) {
    const words = typeof reason === "string" ? reason.trim().split(/\s+/).length : 0;
    if (typeof reason !== "string" || reason.trim().length < MIN_REASON_LENGTH || words < MIN_REASON_WORDS) {
      throw new Error(
        `${where}: "${key}" needs a reason of at least ${MIN_REASON_LENGTH} characters and ${MIN_REASON_WORDS} words`,
      );
    }
  }
  return new Map(entries as Array<[string, string]>);
}

/** Throws unless `violations` (paths) are exactly the rule's exempt paths. */
export function expectExempted(rule: string, violations: readonly string[], dir: string = EXEMPTIONS_DIR): void {
  const exempt = readExemptions(rule, dir);
  const found = new Set(violations);
  const added = [...found].filter((v) => !exempt.has(v)).sort();
  const fixed = [...exempt.keys()].filter((v) => !found.has(v)).sort();
  if (added.length === 0 && fixed.length === 0) return;
  const file = `__tests__/architecture/exemptions/${rule}.json`;
  const lines = [`[architecture:${rule}]`];
  if (added.length > 0) {
    lines.push("Violations. Fix the code, or exempt the file with its reason in " + file + ":", ...added.map((v) => `  - ${v}`));
  }
  if (fixed.length > 0) lines.push(`No longer violating. Delete these from ${file}:`, ...fixed.map((v) => `  - ${v}`));
  throw new Error(lines.join("\n"));
}
