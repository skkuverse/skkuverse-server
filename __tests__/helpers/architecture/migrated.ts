/**
 * The migrated scope (ADR 0010, D12): `__tests__/architecture/migrated-scopes.json`,
 * read by eslint.config.js too. A folder ends in `/`, a single file does not.
 */
import fs from "fs";
import path from "path";
import { ROOT } from "./ratchet";

export const MIGRATED_SCOPES_FILE = "__tests__/architecture/migrated-scopes.json";

export function migratedScopes(): string[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(ROOT, MIGRATED_SCOPES_FILE), "utf8"));
  if (!Array.isArray(parsed) || !parsed.every((s): s is string => typeof s === "string")) {
    throw new Error(`${MIGRATED_SCOPES_FILE} must be a JSON array of strings`);
  }
  return parsed;
}

/** A path inside a scope; a top-level module folder `src/<m>/` also owns `__tests__/nest/<m>/`. */
export function inScope(file: string, scope: string): boolean {
  if (!scope.endsWith("/")) return file === scope;
  if (file.startsWith(scope)) return true;
  const topLevel = /^src\/([^/]+)\/$/.exec(scope);
  return topLevel !== null && file.startsWith(`__tests__/nest/${topLevel[1] ?? ""}/`);
}
