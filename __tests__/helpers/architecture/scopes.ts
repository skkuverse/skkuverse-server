/**
 * The module scopes (ADR 0010, D9): every top-level folder of `src/` (ending in
 * `/`) and every file at its root, derived from the tree so a new module is in
 * scope from its first file. eslint.config.js derives the same list.
 */
import { filesUnder } from "./tree";

let srcScopes: readonly string[] | undefined;

export function moduleScopes(files?: readonly string[]): string[] {
  if (files !== undefined) return scopesOf(files);
  srcScopes ??= scopesOf(filesUnder("src"));
  return [...srcScopes];
}

function scopesOf(files: readonly string[]): string[] {
  const scopes = files.map((file) => {
    const [, top, rest] = /^src\/([^/]+)(\/.*)?$/.exec(file) ?? [];
    if (top === undefined) return undefined;
    return rest === undefined ? `src/${top}` : `src/${top}/`;
  });
  return [...new Set(scopes.filter((s): s is string => s !== undefined && (s.endsWith("/") || s.endsWith(".ts"))))].sort();
}

/** A path inside a scope; a top-level module folder `src/<m>/` also owns `__tests__/nest/<m>/`. */
export function inScope(file: string, scope: string): boolean {
  if (!scope.endsWith("/")) return file === scope;
  if (file.startsWith(scope)) return true;
  const topLevel = /^src\/([^/]+)\/$/.exec(scope);
  return topLevel !== null && file.startsWith(`__tests__/nest/${topLevel[1] ?? ""}/`);
}
