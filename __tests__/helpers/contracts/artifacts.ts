/**
 * The produced contracts, computed from the `.wire` files (ADR 0010, D13):
 * one draft-07 `<id>.schema.json` per
 * zod export, and `index.json` mapping each id to its source file, its export
 * and the routes whose declared type references it. `<id>` is
 * `<wire file base>.<export name>`, so the architecture rules on file and
 * export names keep it stable.
 */
import path from "path";
import ts from "typescript";
import { z } from "zod";
import { ROOT } from "../architecture/ratchet";
import { readSource, sourceFiles } from "../architecture/tree";
import { routeWireRefs, type RouteWireRefs, type WireTypeRef } from "../architecture/wire-routes";

export const INDEX_FILE = "index.json";
export const SCHEMA_SUFFIX = ".schema.json";

export interface WireModule {
  /** Repo-relative path of the `.wire.ts` file. */
  file: string;
  source: string;
  exports: Readonly<Record<string, unknown>>;
}

export interface WireSchema {
  id: string;
  source: string;
  exportName: string;
  schema: z.ZodType;
  /** The export and each `z.input` alias of it: a route's type may name either. */
  names: ReadonlySet<string>;
}

export interface IndexEntry {
  source: string;
  export: string;
  routes: string[];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Every `src/**\/*.wire.ts`, in path order, loaded through ts-jest. */
export function wireModules(): WireModule[] {
  return sourceFiles()
    .filter((file) => file.endsWith(".wire.ts"))
    .sort(byString)
    .map((file) => ({
      file,
      source: readSource(file),
      exports: require(path.join(ROOT, file)) as Record<string, unknown>,
    }));
}

/** `alias → schema export` for each `export type <alias> = z.input<typeof <schema>>`. */
function zodInputAliases(file: string, source: string): Map<string, string> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, false);
  const aliases = new Map<string, string>();
  for (const s of sf.statements) {
    if (!ts.isTypeAliasDeclaration(s) || !ts.isTypeReferenceNode(s.type) || !ts.isQualifiedName(s.type.typeName)) continue;
    const { left, right } = s.type.typeName;
    const arg = s.type.typeArguments?.[0];
    if (ts.isIdentifier(left) && left.text === "z" && right.text === "input" && arg && ts.isTypeQueryNode(arg)) {
      if (ts.isIdentifier(arg.exprName)) aliases.set(s.name.text, arg.exprName.text);
    }
  }
  return aliases;
}

/** The zod exports of each module, modules in path order and exports by name. A duplicate id throws. */
export function wireSchemas(modules: readonly WireModule[]): WireSchema[] {
  const schemas: WireSchema[] = [];
  const sourceOfId = new Map<string, string>();
  for (const m of [...modules].sort((a, b) => byString(a.file, b.file))) {
    const aliases = [...zodInputAliases(m.file, m.source)];
    for (const exportName of Object.keys(m.exports).sort(byString)) {
      const schema = m.exports[exportName];
      if (!(schema instanceof z.ZodType)) continue;
      const id = `${path.posix.basename(m.file, ".wire.ts")}.${exportName}`;
      const taken = sourceOfId.get(id);
      if (taken !== undefined) {
        throw new Error(`[contracts] id ${id} comes from both ${taken} and ${m.file}; rename one file or export`);
      }
      sourceOfId.set(id, m.file);
      const names = new Set([exportName, ...aliases.filter(([, target]) => target === exportName).map(([alias]) => alias)]);
      schemas.push({ id, source: m.file, exportName, schema, names });
    }
  }
  return schemas;
}

export function schemaArtifact(schema: z.ZodType): string {
  return serialize(z.toJSONSchema(schema, { io: "input", target: "draft-7" }));
}

/** Whether a wire name a route references is this schema's export or one of its `z.input` aliases. */
const isNamedBy = (s: WireSchema, ref: WireTypeRef) => ref.wireFile === s.source && s.names.has(ref.name);

/** Each id, in order, with its source, export and the sorted routes whose payload types reference it. */
export function contractIndex(schemas: readonly WireSchema[], routes: readonly RouteWireRefs[]): Record<string, IndexEntry> {
  const index: Record<string, IndexEntry> = {};
  for (const s of [...schemas].sort((a, b) => byString(a.id, b.id))) {
    const served = routes
      .filter((r) => r.refs.some((ref) => isNamedBy(s, ref)))
      .map((r) => r.route);
    index[s.id] = { source: s.source, export: s.exportName, routes: [...new Set(served)].sort(byString) };
  }
  return index;
}

/**
 * `<route>: <wire file>#<name>` for each wire name a route references that maps
 * to no id: an alias of a schema its file does not export, or a name that is
 * no zod export at all.
 */
export function unpublishedWireRefs(schemas: readonly WireSchema[], routes: readonly RouteWireRefs[]): string[] {
  const unpublished = routes.flatMap((r) =>
    r.refs.filter((ref) => !schemas.some((s) => isNamedBy(s, ref))).map((ref) => `${r.route}: ${ref.wireFile}#${ref.name}`),
  );
  return [...new Set(unpublished)];
}

/** File name under `contracts/produced/` → content: `index.json` and one `<id>.schema.json` per schema. */
export function producedFiles(schemas: readonly WireSchema[], routes: readonly RouteWireRefs[]): Map<string, string> {
  const files = new Map([[INDEX_FILE, serialize(contractIndex(schemas, routes))]]);
  for (const s of schemas) files.set(`${s.id}${SCHEMA_SUFFIX}`, schemaArtifact(s.schema));
  return files;
}

/** The routes of every source under src/, with the wire names each declares. */
export function sourceRoutes(): RouteWireRefs[] {
  return sourceFiles().flatMap((file) => routeWireRefs(file, readSource(file)));
}
