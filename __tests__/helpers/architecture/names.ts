/**
 * The suffix vocabulary of ADR 0010 (D4), shared by the architecture rules
 * that read file names: `<name>.<role>.ts`, wrapped by `.spec` and `.generated`.
 */

export const ROLES = new Set([
  "module",
  "controller",
  "service",
  "repository",
  "client",
  "poller",
  "rules",
  "mapper",
  "query",
  "config",
  "schema",
  "wire",
  "ports",
  "types",
  "document",
  "constants",
  "error",
  "middleware",
  "filter",
  "interceptor",
  "guard",
  "pipe",
  "decorator",
  "bootstrap",
  "util",
]);

export const CLASS_ROLES = new Set([
  "module",
  "controller",
  "service",
  "repository",
  "client",
  "poller",
  "error",
  "middleware",
  "filter",
  "interceptor",
  "guard",
  "pipe",
]);

export const EXEMPT = new Set([
  "src/main.ts",
  "src/instrument.ts",
  "src/app.module.ts",
  "src/types.d.ts",
  // Pinned by the umbrella repo's contract manifest (.contracts.lock.json).
  "src/notices/notices.topics.ts",
  // Imported by the hash-locked notices.topics.ts (.contracts.lock.json); changes go through the producer repo.
  "src/notices/tabConfig.ts",
  "src/notices/types.ts",
  // The one entry the perimeter registry loads by path, named by the shape it exports (ADR 0023, D4).
  "src/perimeter/current/perimeter.overlay.ts",
]);

export interface ParsedName {
  /** Dot-separated parts without `.ts`, `.spec` and `.generated`. */
  parts: string[];
  dir: string;
}

export function parse(file: string): ParsedName {
  const slash = file.lastIndexOf("/");
  let parts = file.slice(slash + 1).replace(/\.ts$/, "").split(".");
  if (parts.at(-1) === "spec") parts = parts.slice(0, -1);
  if (parts.at(-1) === "generated") parts = parts.slice(0, -1);
  return { parts, dir: file.slice(0, slash) };
}

