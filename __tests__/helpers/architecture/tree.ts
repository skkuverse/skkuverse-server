import fs from "fs";
import path from "path";
import { ROOT } from "./ratchet";

/** Repo-relative, `/`-separated paths of the files under `dir`, sorted. */
export function filesUnder(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { recursive: true, encoding: "utf8" })
    .map((rel) => path.posix.join(dir, rel.split(path.sep).join("/")))
    .filter((rel) => fs.statSync(path.join(ROOT, rel)).isFile())
    .sort();
}

/** Repo-relative, `/`-separated paths of the directories under `dir`, sorted. */
export function dirsUnder(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  return fs
    .readdirSync(abs, { recursive: true, encoding: "utf8" })
    .map((rel) => path.posix.join(dir, rel.split(path.sep).join("/")))
    .filter((rel) => fs.statSync(path.join(ROOT, rel)).isDirectory())
    .sort();
}

export function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** The TypeScript sources under src/, excluding specs. */
export function sourceFiles(): string[] {
  return filesUnder("src").filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
}
