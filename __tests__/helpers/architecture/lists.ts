/**
 * (An operations detail is left out of the public history.)
 *
 *
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { SIZE_CAPS } from "./exemptions";
import { ROOT } from "./ratchet";

export const LIST_DIRS = ["allowlists", "caps", "exemptions", "ratchets"] as const;
export type ListDir = (typeof LIST_DIRS)[number];

/** The ratchets, each with the decision it waits on: a file in `ratchets/` that is not here fails `list-registry`. */
export const RATCHET_DECISIONS: Readonly<Record<string, string>> = {};

export const DEBT_TRAILER = "Architecture-Debt";

/** Each exemption file, with the decisions a new entry's reason may cite: a file not here takes no new entry. */
export const EXEMPTION_DECISIONS: Readonly<Record<string, readonly string[]>> = {
  "config-files": ["ADR 0010 D5"],
  "production-callers": ["ADR 0010 D2", "ADR 0011 D2"],
  "repository-reads": ["ADR 0010 D2"],
  "service-specs": ["ADR 0010 D1"],
  "short-names": ["ADR 0010 D4"],
  "size-caps": ["ADR 0010 D9"],
  "spec-mocks": ["ADR 0011 D2"],
};

const git = (args: readonly string[]): string => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** The ref the lists are compared with, and whether `ARCHITECTURE_BASE` named it. */
export function baseRef(env: NodeJS.ProcessEnv = process.env): { ref: string; explicit: boolean } {
  if (env.ARCHITECTURE_BASE) return { ref: env.ARCHITECTURE_BASE, explicit: true };
  return { ref: env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : "origin/dev", explicit: false };
}

/** The commit to compare the lists with, or undefined when the base ref is not in this checkout. */
export function baseCommit(env: NodeJS.ProcessEnv = process.env): string | undefined {
  try {
    return git(["merge-base", "HEAD", baseRef(env).ref]).trim();
  } catch {
    return undefined;
  }
}

/** Why a missing base fails the run, or undefined when it may be skipped (a local checkout without the ref). */
export function missingBaseProblem(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const { ref, explicit } = baseRef(env);
  if (explicit) return `ARCHITECTURE_BASE=${ref} is not in this checkout (new branch or rewritten history?)`;
  return env.CI ? `list-growth needs ${ref} in the checkout: fetch the base branch (actions/checkout with fetch-depth: 0)` : undefined;
}

/** The entries of a list file's text: an array's strings, or an object's keys. */
export function listEntries(text: string | undefined): string[] {
  if (text === undefined) return [];
  const parsed: unknown = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
  return parsed !== null && typeof parsed === "object" ? Object.keys(parsed) : [];
}

/** An exemption's reason (a string, or a size cap's `reason`), or undefined. */
export function exemptionReason(text: string, key: string): string | undefined {
  const value = (JSON.parse(text) as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  const reason = value !== null && typeof value === "object" ? (value as { reason?: unknown }).reason : undefined;
  return typeof reason === "string" ? reason : undefined;
}

/** A cap's limit (a number, or a size cap's `max`), or undefined when the text or the key is missing. */
export function capMax(text: string | undefined, key: string): number | undefined {
  if (text === undefined) return undefined;
  const value = (JSON.parse(text) as Record<string, unknown>)[key];
  const max = value !== null && typeof value === "object" ? (value as { max?: unknown }).max : value;
  return typeof max === "number" ? max : undefined;
}

export interface ListChange {
  /** Repo-relative path: `__tests__/architecture/<dir>/<rule>.json`. */
  file: string;
  /** The file's text before (at the base, or at the commit's parent), or undefined when it did not exist. */
  before: string | undefined;
  /** The file's text after (now, or at the commit), or undefined when it was deleted. */
  after: string | undefined;
}

export interface ListCommit {
  hash: string;
  /** The list paths its `Architecture-Debt:` trailers name. */
  debt: string[];
  /** The paths it changed. */
  changed: string[];
  /** The list files it changed, against its parent. */
  lists: ListChange[];
}

export interface ListGate {
  /** The decisions `docs/decisions/` declares, as `ADR 0010 D9`. */
  decisions: ReadonlySet<string>;
  /** The decisions a reason cites. */
  cited: (reason: string) => string[];
  /** The rule files that read a list: changing one of them is what lets a commit record debt in it. */
  readers: (listFile: string) => readonly string[];
}

const dirOf = (file: string): string | undefined => /^__tests__\/architecture\/([^/]+)\/[^/]+\.json$/.exec(file)?.[1];
const nameOf = (file: string): string => path.basename(file, ".json");

/** The commits that made `grew(before, after)` true for a list file. */
const commitsThat = (commits: readonly ListCommit[], file: string, grew: (change: ListChange) => boolean): ListCommit[] =>
  commits.filter((c) => c.lists.some((l) => l.file === file && grew(l)));

const describeCommits = (commits: readonly ListCommit[]): string =>
  commits.length === 0 ? "no commit of its own added it" : `added by ${commits.map((c) => c.hash.slice(0, 8)).join(", ")}`;

function exemptionViolations(change: ListChange, commits: readonly ListCommit[], gate: ListGate): string[] {
  const { file, before, after } = change;
  const name = nameOf(file);
  const allowed = EXEMPTION_DECISIONS[name];
  const was = new Set(listEntries(before));
  const added = listEntries(after).filter((e) => !was.has(e));
  const out = added.flatMap((entry) => {
    const cited = gate.cited(exemptionReason(after ?? "{}", entry) ?? "");
    const ok = allowed !== undefined && cited.length > 0 && cited.every((d) => gate.decisions.has(d)) && cited.some((d) => allowed.includes(d));
    if (ok) return [];
    const why = allowed === undefined ? `register ${name} in EXEMPTION_DECISIONS first` : `a new exemption cites the decision behind it: ${allowed.join(" or ")}`;
    return [`${file}: ${entry} (${why})`];
  });
  return name === SIZE_CAPS ? [...out, ...capRaises(change, commits, { keysAdded: false })] : out;
}

/**
 * `<file>: <key> max raised (…)` for each cap above the base whose raising commits do not all carry the trailer.
 * With `keysAdded`, a new key is a raise from nothing (`caps/`); a new size-cap exemption is checked by its reason.
 */
function capRaises(change: ListChange, commits: readonly ListCommit[], { keysAdded }: { keysAdded: boolean }): string[] {
  const { file, before, after } = change;
  const was = new Set(listEntries(before));
  const absent = keysAdded ? 0 : Infinity;
  const risen = listEntries(after).filter((e) => (keysAdded || was.has(e)) && (capMax(after, e) ?? 0) > (capMax(before, e) ?? 0));
  return risen.flatMap((entry) => {
    const raised = commitsThat(commits, file, (l) => (capMax(l.after, entry) ?? 0) > (capMax(l.before, entry) ?? absent));
    if (raised.length > 0 && raised.every((c) => c.debt.includes(file))) return [];
    return [`${file}: ${entry} max raised (${describeCommits(raised)}; each commit that raises a cap carries "${DEBT_TRAILER}: ${file}")`];
  });
}

/** `<file>: <entry> (<why>)` for each entry a list gained, or cap it raised, that its kind of list may not. */
export function growthViolations(changes: readonly ListChange[], commits: readonly ListCommit[], gate: ListGate): string[] {
  return changes.flatMap((change) => {
    if (dirOf(change.file) === "exemptions") return exemptionViolations(change, commits, gate);
    if (dirOf(change.file) === "caps") return capRaises(change, commits, { keysAdded: true });
    const { file, before, after } = change;
    const was = new Set(listEntries(before));
    const readers = new Set(gate.readers(file));
    return listEntries(after)
      .filter((entry) => !was.has(entry))
      .flatMap((entry) => {
        const added = commitsThat(commits, file, (l) => listEntries(l.after).includes(entry) && !listEntries(l.before).includes(entry));
        const recorded = added.length > 0 && added.every((c) => c.debt.includes(file) && c.changed.some((f) => readers.has(f)));
        if (recorded) return [];
        const rule = readers.size === 0 ? "no rule reads it" : [...readers].join(", ");
        return [`${file}: ${entry} (only shrinks; ${describeCommits(added)}; record debt with "${DEBT_TRAILER}: ${file}" in the commit that adds it and changes its rule: ${rule})`];
      });
  });
}

/** The list files under `__tests__/architecture/<dir>/` now, with their text at `base`. */
export function listChanges(base: string): ListChange[] {
  return LIST_DIRS.flatMap((dir) => {
    const abs = path.join(ROOT, "__tests__/architecture", dir);
    if (!fs.existsSync(abs)) return [];
    return fs
      .readdirSync(abs)
      .filter((f) => f.endsWith(".json"))
      .map((name) => {
        const file = `__tests__/architecture/${dir}/${name}`;
        return { file, before: showFile(base, file), after: fs.readFileSync(path.join(ROOT, file), "utf8") };
      });
  });
}

function showFile(commit: string, file: string): string | undefined {
  try {
    return git(["show", `${commit}:${file}`]);
  } catch {
    return undefined;
  }
}

/** Each non-merge commit since `base`, with its debt trailers, the paths it changed and its list changes. */
export function listCommits(base: string): ListCommit[] {
  const hashes = git(["log", "--no-merges", "--format=%H", `${base}..HEAD`]).split("\n").filter(Boolean);
  return hashes.map((hash) => {
    const debt = git(["log", "-1", `--format=%(trailers:key=${DEBT_TRAILER},valueonly)`, hash])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const changed = git(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", hash]).split("\n").filter(Boolean);
    const lists = changed
      .filter((f) => dirOf(f) !== undefined && (LIST_DIRS as readonly string[]).includes(dirOf(f) ?? ""))
      .map((file) => ({ file, before: showFile(`${hash}^`, file), after: showFile(hash, file) }));
    return { hash, debt, changed, lists };
  });
}

/** The rule files whose text names a list (`"<name>"` or `<dir>/<name>.json`), among `sources` (path → text). */
export function listReaders(listFile: string, sources: ReadonlyMap<string, string>): string[] {
  const name = nameOf(listFile);
  const relative = `${dirOf(listFile) ?? ""}/${name}.json`;
  return [...sources].filter(([file, text]) => file !== LIST_GROWTH_TEST && (text.includes(`"${name}"`) || text.includes(relative))).map(([file]) => file);
}

export const LIST_GROWTH_TEST = "__tests__/architecture/list-growth.test.ts";
