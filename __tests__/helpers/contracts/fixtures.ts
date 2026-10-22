/**
 * The golden fixtures' checks (ADR 0010, D13). Each
 * produced id has at least one `contracts/produced/fixtures/<id>/<case>.json`
 * of the shape `{ "_about": "<where it comes from>", "data": … }`; its `data`
 * parses with the id's wire schema, and the id's published JSON Schema
 * declares every property in it, so the published schema documents every
 * field the server really sends.
 */
import { z } from "zod";
import { undeclaredKeys } from "./undeclared-keys";

export const FIXTURES_DIR = "contracts/produced/fixtures";

export interface Fixture {
  /** Repo-relative path. */
  file: string;
  json: unknown;
}

export interface FixtureSubject {
  /** The export the index names: a zod schema, unless the index is stale. */
  schema: unknown;
  /** The parsed `<id>.schema.json`, or undefined when it is missing. */
  published: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const FIXTURE_PATH = new RegExp(`^${FIXTURES_DIR}/([^/]+)/[^/]+\\.json$`);

function shapeViolation(json: unknown): string | undefined {
  if (!isRecord(json) || Object.keys(json).sort().join(",") !== "_about,data") return "is not { _about, data }";
  if (typeof json._about !== "string" || json._about.trim() === "") return "_about is not a non-empty string";
  return undefined;
}

/** A violation per fixture or id that breaks a rule above, ids in order and files in path order. */
export function fixtureViolations(
  ids: readonly string[],
  fixtures: readonly Fixture[],
  subjectOf: (id: string) => FixtureSubject,
): string[] {
  const known = new Set(ids);
  const byId = new Map<string, Fixture[]>();
  const out: string[] = [];
  for (const fixture of [...fixtures].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    const id = FIXTURE_PATH.exec(fixture.file)?.[1];
    if (id === undefined) out.push(`${fixture.file}: not at ${FIXTURES_DIR}/<id>/<case>.json`);
    else if (!known.has(id)) out.push(`${fixture.file}: ${id} is no id in index.json`);
    else byId.set(id, [...(byId.get(id) ?? []), fixture]);
  }
  for (const id of [...ids].sort()) {
    const cases = byId.get(id) ?? [];
    if (cases.length === 0) out.push(`${id}: no fixture in ${FIXTURES_DIR}/${id}/`);
    const { schema, published } = subjectOf(id);
    if (!(schema instanceof z.ZodType)) out.push(`${id}: the index's source and export name no zod schema`);
    if (published === undefined) out.push(`${id}: ${id}.schema.json is missing`);
    for (const { file, json } of cases) {
      const shape = shapeViolation(json);
      if (shape !== undefined) {
        out.push(`${file}: ${shape}`);
        continue;
      }
      const data = (json as { data: unknown }).data;
      if (schema instanceof z.ZodType) {
        const parsed = schema.safeParse(data);
        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`);
          out.push(`${file}: data does not parse (${issues.join("; ")})`);
        }
      }
      if (published !== undefined) {
        out.push(...undeclaredKeys(published, data).map((key) => `${file}: ${key} is not declared in ${id}.schema.json`));
      }
    }
  }
  return out;
}
