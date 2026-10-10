import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { ROOT } from "./ratchet";

/**
 * Repo-relative, `/`-separated paths of the files under `dir`, sorted: what git
 * tracks or would track (untracked but not ignored), and still on disk. A
 * local stray (`.DS_Store`, a build artifact) never fails a rule that CI passes.
 */
export function filesUnder(dir: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", dir], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return [...new Set(out.split("\0").filter(Boolean))]
    .filter((rel) => fs.existsSync(path.join(ROOT, rel)))
    .sort();
}

/** The directories under `dir` that hold at least one of those files, sorted. */
export function dirsUnder(dir: string): string[] {
  const dirs = new Set<string>();
  for (const file of filesUnder(dir)) {
    for (let d = path.posix.dirname(file); d.startsWith(`${dir}/`); d = path.posix.dirname(d)) {
      dirs.add(d);
    }
  }
  return [...dirs].sort();
}

export function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** The TypeScript sources under src/, excluding specs. */
export function sourceFiles(): string[] {
  return filesUnder("src").filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
}
