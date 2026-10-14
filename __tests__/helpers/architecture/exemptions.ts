/**
 * A reasoned exemption: `__tests__/architecture/exemptions/<rule>.json`, an
 * object from a file to why the rule does not apply to it. An allowlist
 * (ratchet.ts) records debt in modules not yet migrated and only shrinks, so
 * a migrated scope carries none (migrated-scopes.test.ts). An exemption is a
 * decision that holds in a migrated scope, so it lives apart from the
 * allowlists and every entry states its reason, which review reads.
 *
 * The harness fails on a violation that is not exempt, on an exempt file that
 * no longer violates (delete the entry), on a key written twice (JSON.parse
 * would keep the last one silently), and on a reason that is not one: see
 * `reasonProblem`. `size-caps.json` maps a file to `{ max, reason }` instead
 * (`readSizeCapExemptions`).
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { ROOT } from "./ratchet";

export const EXEMPTIONS_DIR = path.join(ROOT, "__tests__/architecture/exemptions");
export const DECISIONS_DIR = path.join(ROOT, "docs/decisions");
export const MIN_REASON_LENGTH = 40;
export const MIN_REASON_WORDS = 6;
/** No one word may fill more of a reason than this share of its words: `x x x x x x` is no reason. */
export const MAX_WORD_SHARE = 0.25;

/** `ADR 0010 D9`, `ADR 0010, D1`: a decision a reason cites. */
export const DECISION_CITATION = /\bADR (\d{4}),? (D\d+)\b/g;

/** Something a reader can open: a backticked name, a file, a `src/` or `docs/` path, or a decision. */
const EVIDENCE = /`[^`]+`|\b[\w.-]+\.(?:ts|js|json|md)\b|\bsrc\/|\bdocs\/|\bADR \d{4},? D\d+\b/;

const words = (text: string): string[] => text.toLowerCase().match(/[a-z]{3,}/g) ?? [];

/** The `### D<n>.` headings of `docs/decisions/<number>-*.md`, as `ADR <number> D<n>`. */
export function decisionHeadings(dir: string = DECISIONS_DIR): Set<string> {
  const out = new Set<string>();
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const adr = /^(\d{4})-.*\.md$/.exec(name)?.[1];
    if (adr === undefined) continue;
    for (const m of fs.readFileSync(path.join(dir, name), "utf8").matchAll(/^###\s+(D\d+)\./gm)) out.add(`ADR ${adr} ${m[1]}`);
  }
  return out;
}

/** The decisions a reason cites, as `ADR <number> D<n>`. */
export const citedDecisions = (reason: string): string[] =>
  [...reason.matchAll(DECISION_CITATION)].map((m) => `ADR ${m[1]} ${m[2]}`);

/** Why a reason is not one, or undefined: too short, filler, no evidence named, or a decision that does not exist. */
export function reasonProblem(reason: unknown, decisions: ReadonlySet<string>): string | undefined {
  if (typeof reason !== "string") return "is not a string";
  const text = reason.trim();
  const all = words(text);
  if (text.length < MIN_REASON_LENGTH || text.split(/\s+/).length < MIN_REASON_WORDS) {
    return `needs at least ${MIN_REASON_LENGTH} characters and ${MIN_REASON_WORDS} words`;
  }
  if (new Set(all).size < MIN_REASON_WORDS) return `needs ${MIN_REASON_WORDS} different words`;
  const counts = new Map<string, number>();
  for (const w of all) counts.set(w, (counts.get(w) ?? 0) + 1);
  if ([...counts.values()].some((n) => n / all.length > MAX_WORD_SHARE)) return "repeats one word for most of its length";
  if (!EVIDENCE.test(text)) return "names no evidence: a file, a `name`, a src/ or docs/ path, or an ADR decision (ADR 0010 D9)";
  const missing = citedDecisions(text).filter((d) => !decisions.has(d));
  if (missing.length > 0) return `cites ${missing.join(", ")}, which no heading in docs/decisions/ declares`;
  return undefined;
}

/** The object a JSON exemption file holds, its keys in order; throws on a key written twice, unsorted keys or a non-object. */
export function readJsonObject(file: string): Array<[string, unknown]> {
  const where = path.relative(ROOT, file);
  const text = fs.readFileSync(file, "utf8");
  const root = ts.parseJsonText(where, text).statements[0]?.expression;
  if (root === undefined || !ts.isObjectLiteralExpression(root)) throw new Error(`${where} must be a JSON object from a path to its reason`);
  const keys = root.properties.flatMap((p) => (p.name && ts.isStringLiteral(p.name) ? [p.name.text] : []));
  const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (twice.length > 0) throw new Error(`${where} writes ${[...new Set(twice)].join(", ")} twice`);
  if (keys.join("\n") !== [...keys].sort().join("\n")) throw new Error(`${where} must list its paths sorted`);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return keys.map((k) => [k, parsed[k]]);
}

/** A missing file is no exemption. Keys must be sorted and written once; each value must be a reason (`reasonProblem`), each its own. */
export function readExemptions(
  rule: string,
  dir: string = EXEMPTIONS_DIR,
  decisions: ReadonlySet<string> = decisionHeadings(),
): Map<string, string> {
  const file = path.join(dir, `${rule}.json`);
  if (!fs.existsSync(file)) return new Map();
  const where = path.relative(ROOT, file);
  const entries = readJsonObject(file);
  const seen = new Map<string, string>();
  for (const [key, reason] of entries) {
    const problem = reasonProblem(reason, decisions);
    if (problem !== undefined) throw new Error(`${where}: the reason for "${key}" ${problem}`);
    const normalized = (reason as string).trim().toLowerCase().replace(/\s+/g, " ");
    const earlier = seen.get(normalized);
    if (earlier !== undefined) throw new Error(`${where}: "${key}" repeats the reason of "${earlier}"; say why this one is exempt`);
    seen.set(normalized, key);
  }
  return new Map(entries as Array<[string, string]>);
}

export interface SizeCapExemption {
  max: number;
  reason: string;
}

export const SIZE_CAPS = "size-caps";

/** `exemptions/size-caps.json`: a file → the `max-lines` it may reach and why, its reasons read as readExemptions reads them. */
export function readSizeCapExemptions(
  dir: string = EXEMPTIONS_DIR,
  decisions: ReadonlySet<string> = decisionHeadings(),
): Map<string, SizeCapExemption> {
  const file = path.join(dir, `${SIZE_CAPS}.json`);
  if (!fs.existsSync(file)) return new Map();
  const where = path.relative(ROOT, file);
  const out = new Map<string, SizeCapExemption>();
  for (const [key, value] of readJsonObject(file)) {
    const entry = value as Partial<SizeCapExemption> | null;
    const keys = typeof entry === "object" && entry !== null ? Object.keys(entry).sort().join(",") : "";
    if (keys !== "max,reason" || !Number.isInteger(entry?.max) || (entry?.max ?? 0) < 1) {
      throw new Error(`${where}: "${key}" must be { "max": <lines>, "reason": "…" }`);
    }
    const problem = reasonProblem(entry?.reason, decisions);
    if (problem !== undefined) throw new Error(`${where}: the reason for "${key}" ${problem}`);
    out.set(key, { max: entry?.max as number, reason: entry?.reason as string });
  }
  return out;
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
