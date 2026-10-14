/**
 * The lists a rule keeps beside it, and how each may change against the base
 * branch (`list-growth`, architecture tests):
 *
 *   - `allowlists/<rule>.json` and `ratchets/<rule>.json` only shrink. An
 *     entry the base did not have fails, unless a commit since the base
 *     carries `Architecture-Debt: <list path>` and changes the rule itself
 *     (a file under `__tests__/architecture/` or `eslint.config.js` that is
 *     not a list): a new or stricter rule records the debt that exists.
 *   - `exemptions/<rule>.json` may gain an entry only when its reason cites
 *     a decision (`ADR 0010 D9`) that a heading in `docs/decisions/` declares.
 *
 * The base is the merge base of HEAD and `ARCHITECTURE_BASE`, else
 * `origin/$GITHUB_BASE_REF` on a pull request, else `origin/dev`. CI checks out
 * full history for this (`.github/workflows/ci.yml`); a checkout without the
 * base ref fails in CI and is skipped locally.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { ROOT } from "./ratchet";

export const LIST_DIRS = ["allowlists", "exemptions", "ratchets"] as const;
export type ListDir = (typeof LIST_DIRS)[number];

/** The ratchets, each with the decision it waits on: a file in `ratchets/` that is not here fails `list-registry`. */
export const RATCHET_DECISIONS: Readonly<Record<string, string>> = {
  "root-exports-shared": "ADR 0010 D9",
};

export const DEBT_TRAILER = "Architecture-Debt";

const git = (args: readonly string[]): string => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** The commit to compare the lists with, or undefined when the base ref is not in this checkout. */
export function baseCommit(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const ref = env.ARCHITECTURE_BASE ?? (env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : "origin/dev");
  try {
    return git(["merge-base", "HEAD", ref]).trim();
  } catch {
    return undefined;
  }
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

export interface ListChange {
  /** Repo-relative path: `__tests__/architecture/<dir>/<rule>.json`. */
  file: string;
  /** The file's text at the base, or undefined when it did not exist. */
  before: string | undefined;
  /** The file's text now. */
  after: string;
}

export interface DebtCommit {
  /** The list paths its `Architecture-Debt:` trailers name. */
  lists: string[];
  /** The paths it changed. */
  changed: string[];
}

const dirOf = (file: string): string | undefined => /^__tests__\/architecture\/([^/]+)\/[^/]+\.json$/.exec(file)?.[1];

const isRuleFile = (f: string): boolean =>
  f === "eslint.config.js" || (/^__tests__\/(?:helpers\/)?architecture\//.test(f) && f.endsWith(".ts"));

const changesRule = (changed: readonly string[]): boolean => changed.some(isRuleFile);

/** `<file>: <entry> (<why>)` for each entry a list gained that its kind of list may not gain. */
export function growthViolations(
  changes: readonly ListChange[],
  recordedDebt: readonly DebtCommit[],
  decisions: ReadonlySet<string>,
  cited: (reason: string) => string[],
): string[] {
  return changes.flatMap(({ file, before, after }) => {
    const was = new Set(listEntries(before));
    const added = listEntries(after).filter((e) => !was.has(e));
    if (added.length === 0) return [];
    if (dirOf(file) === "exemptions") {
      return added.flatMap((entry) => {
        const decision = cited(exemptionReason(after, entry) ?? "");
        if (decision.length > 0 && decision.every((d) => decisions.has(d))) return [];
        return [`${file}: ${entry} (a new exemption cites the decision behind it, e.g. "ADR 0010 D9")`];
      });
    }
    const recorded = recordedDebt.some((c) => c.lists.includes(file) && changesRule(c.changed));
    return recorded ? [] : added.map((entry) => `${file}: ${entry} (only shrinks; a rule's own commit records debt with "${DEBT_TRAILER}: ${file}")`);
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
        let before: string | undefined;
        try {
          before = git(["show", `${base}:${file}`]);
        } catch {
          before = undefined;
        }
        return { file, before, after: fs.readFileSync(path.join(ROOT, file), "utf8") };
      });
  });
}

/** The commits since `base` that carry an `Architecture-Debt:` trailer. */
export function debtCommits(base: string): DebtCommit[] {
  const hashes = git(["log", "--format=%H", `${base}..HEAD`]).split("\n").filter(Boolean);
  return hashes.flatMap((hash) => {
    const lists = git(["log", "-1", `--format=%(trailers:key=${DEBT_TRAILER},valueonly)`, hash])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lists.length === 0) return [];
    const changed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "-m", hash]).split("\n").filter(Boolean);
    return [{ lists, changed }];
  });
}
