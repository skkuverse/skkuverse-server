/**
 * A `.wire` file publishes what a server deployable writes to another
 * repository, so each schema in it exports to JSON Schema without losing a
 * constraint (ADR 0010, D13; define-boundary-contracts design D3). Five checks,
 * no allowlist, since the rule binds the first wire file:
 *
 *   - banned calls: no `.transform`, `.refine`, `.superRefine`, `.check`,
 *     `.brand`, `.pipe`, `.overwrite` or `.strict`, and no `z.preprocess`,
 *     `z.custom`, `z.date`, `z.strictObject`, `z.instanceof` or `z.lazy`. The
 *     export cannot be trusted to catch them: it drops a refinement or a
 *     brand, and exports only the input side of a transform or a pipe.
 *   - exports: every runtime export is a zod schema, and every exported type
 *     is a `z.input<…>` alias.
 *   - export: `z.toJSONSchema` succeeds in input and output mode (draft-07).
 *     The output mode throws on a transform buried in an imported piece.
 *   - open objects: the input-mode JSON holds no `additionalProperties: false`
 *     at any depth, so a consumer holding an older copy accepts a new field.
 *   - timestamps: a property named for an instant (`<event>At`, naming.md) is
 *     a `date-time` string, as `z.iso.datetime()` exports it. The server
 *     sends dates through `toISOString()`. An object so named is a structured
 *     date served as one (a notice badge's `{ date, time }`), not an instant.
 */
import path from "path";
import ts from "typescript";
import { z } from "zod";
import { exportsOf, isExported, parseSource } from "../helpers/architecture/ast";
import { numberedKeys } from "../helpers/architecture/comments";
import { ROOT } from "../helpers/architecture/ratchet";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const BANNED_METHODS = new Set(["transform", "refine", "superRefine", "check", "brand", "pipe", "overwrite", "strict"]);
const BANNED_Z_CALLS = new Set(["preprocess", "custom", "date", "strictObject", "instanceof", "lazy"]);
const TARGET = "draft-7";
const INSTANT_KEY = /[a-z0-9]At$/;

type WireExports = Record<string, unknown>;
type Json = unknown;

/** `<file>: .<method>` or `<file>: z.<call>` for each banned call, `#n` on repeats. */
export function bannedCallViolations(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const labels: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { expression: receiver, name } = node.expression;
      if (ts.isIdentifier(receiver) && receiver.text === "z" && BANNED_Z_CALLS.has(name.text)) {
        labels.push(`z.${name.text}`);
      } else if (BANNED_METHODS.has(name.text)) {
        labels.push(`.${name.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return numberedKeys(file, labels);
}

const isZodInput = (type: ts.TypeNode) =>
  ts.isTypeReferenceNode(type) &&
  ts.isQualifiedName(type.typeName) &&
  ts.isIdentifier(type.typeName.left) &&
  type.typeName.left.text === "z" &&
  type.typeName.right.text === "input";

/** `type <name>` for each exported type that is not a `z.input<…>` alias exported in place. */
function exportedTypesNotZodInput(file: string, source: string): string[] {
  return exportsOf(parseSource(file, source))
    .bindings.filter((b) => b.isType)
    .flatMap((b) => {
      const d = b.declaration;
      const isZodInputInPlace = d !== undefined && isExported(d) && ts.isTypeAliasDeclaration(d) && isZodInput(d.type);
      return isZodInputInPlace ? [] : [`type ${b.exported}`];
    });
}

const isZodSchema = (value: unknown): value is z.ZodType => value instanceof z.ZodType;

/** `<file>: <name> is not a zod schema` and `<file>: type <name> is not a z.input alias`. */
export function exportViolations(file: string, source: string, exported: WireExports): string[] {
  const values = Object.keys(exported)
    .filter((name) => name !== "__esModule" && !isZodSchema(exported[name]))
    .map((name) => `${file}: ${name} is not a zod schema`);
  const types = exportedTypesNotZodInput(file, source).map((label) => `${file}: ${label} is not a z.input alias`);
  return [...values, ...types].sort();
}

function schemasOf(exported: WireExports): Array<[string, z.ZodType]> {
  return Object.entries(exported)
    .filter((entry): entry is [string, z.ZodType] => isZodSchema(entry[1]))
    .sort(([a], [b]) => a.localeCompare(b));
}

function exportJson(schema: z.ZodType, io: "input" | "output"): { json: Json } | { error: string } {
  try {
    return { json: z.toJSONSchema(schema, { io, target: TARGET }) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** `<file>#<name>: <mode> mode throws (<message>)` for each schema export that does not export. */
export function exportFailures(file: string, exported: WireExports): string[] {
  return schemasOf(exported).flatMap(([name, schema]) =>
    (["input", "output"] as const).flatMap((io) => {
      const result = exportJson(schema, io);
      return "error" in result ? [`${file}#${name}: ${io} mode throws (${result.error})`] : [];
    }),
  );
}

/** Every object node of a JSON value, with its JSON pointer. */
function objectNodes(json: Json, pointer = "#"): Array<[string, Record<string, Json>]> {
  if (Array.isArray(json)) return json.flatMap((item, i) => objectNodes(item, `${pointer}/${i}`));
  if (typeof json !== "object" || json === null) return [];
  const node = json as Record<string, Json>;
  return [
    [pointer, node],
    ...Object.entries(node).flatMap(([key, value]) => objectNodes(value, `${pointer}/${key}`)),
  ];
}

/** The input-mode JSON Schema of each schema export that exports; `exportFailures` reports the rest. */
function inputJsonOf(exported: WireExports): Array<[string, Json]> {
  return schemasOf(exported).flatMap(([name, schema]) => {
    const result = exportJson(schema, "input");
    return "json" in result ? [[name, result.json] as [string, Json]] : [];
  });
}

/** `<file>#<name>: additionalProperties false at <pointer>` for each closed object in the input-mode export. */
export function closedObjectViolations(file: string, exported: WireExports): string[] {
  return inputJsonOf(exported).flatMap(([name, json]) =>
    objectNodes(json)
      .filter(([, node]) => node.additionalProperties === false)
      .map(([pointer]) => `${file}#${name}: additionalProperties false at ${pointer}`),
  );
}

function isDateTime(node: Json): boolean {
  if (typeof node !== "object" || node === null) return false;
  const schema = node as Record<string, Json>;
  const members = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(members)) {
    const nonNull = members.filter((m) => (m as Record<string, Json>)?.type !== "null");
    return nonNull.length > 0 && nonNull.every(isDateTime);
  }
  return schema.type === "string" && schema.format === "date-time";
}

/** An object schema, nullable or not: a structured date, which the timestamp rule leaves alone. */
function isObjectNode(node: Json): boolean {
  if (typeof node !== "object" || node === null) return false;
  const schema = node as Record<string, Json>;
  const members = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(members)) {
    const nonNull = members.filter((m) => (m as Record<string, Json>)?.type !== "null");
    return nonNull.length > 0 && nonNull.every(isObjectNode);
  }
  return schema.type === "object";
}

/** `<file>#<name>: <pointer> is not z.iso.datetime()` for each `<event>At` property that is not a date-time string. */
export function timestampViolations(file: string, exported: WireExports): string[] {
  return inputJsonOf(exported).flatMap(([name, json]) =>
    objectNodes(json).flatMap(([pointer, node]) => {
      const properties = node.properties;
      if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return [];
      return Object.entries(properties as Record<string, Json>)
        .filter(([key, sub]) => INSTANT_KEY.test(key) && !isDateTime(sub) && !isObjectNode(sub))
        .map(([key]) => `${file}#${name}: ${pointer}/properties/${key} is not z.iso.datetime()`);
    }),
  );
}

/** Runs a synthetic wire source as CommonJS, with zod as its only import. */
function loadSource(source: string): WireExports {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loaded = { exports: {} as WireExports };
  const requireZod = (id: string): unknown => {
    if (id !== "zod") throw new Error(`a synthetic wire source imports only zod, not ${id}`);
    return require("zod");
  };
  new Function("exports", "require", "module", outputText)(loaded.exports, requireZod, loaded);
  return loaded.exports;
}

const FILE = "src/x/x.wire.ts";
const ZOD = 'import { z } from "zod";';
const PLAIN = [
  ZOD,
  "export const xItem = z.object({",
  '  kind: z.enum(["a", "b"]),',
  "  name: z.string().regex(/^[a-z]+$/),",
  "  transform: z.string().nullable(),",
  "  sentAt: z.iso.datetime(),",
  "  endAt: z.iso.datetime().nullable().optional(),",
  "  format: z.string(),",
  "  tags: z.array(z.object({ label: z.string() })),",
  "});",
  'export const xList = z.object({ items: z.array(xItem), action: z.discriminatedUnion("type", [',
  '  z.object({ type: z.literal("route"), value: z.string() }),',
  '  z.object({ type: z.literal("none") }),',
  "]) });",
  "export type XItem = z.input<typeof xItem>;",
  "export type XList = z.input<typeof xList>;",
].join("\n");

describe("wire schema rules apply as specified", () => {
  it.each([
    ["z.string().transform((s) => s.length)", ".transform"],
    ["z.number().refine((n) => n > 0)", ".refine"],
    ["z.object({}).superRefine(() => {})", ".superRefine"],
    ["z.string().check(z.minLength(1))", ".check"],
    ['z.number().brand<"XId">()', ".brand"],
    ["z.string().pipe(z.string())", ".pipe"],
    ["z.string().overwrite((s) => s.trim())", ".overwrite"],
    ["z.object({}).strict()", ".strict"],
    ["z.preprocess((v) => v, z.string())", "z.preprocess"],
    ["z.custom<string>()", "z.custom"],
    ["z.date()", "z.date"],
    ["z.strictObject({})", "z.strictObject"],
    ["z.instanceof(Date)", "z.instanceof"],
    ["z.lazy(() => z.string())", "z.lazy"],
  ])("banned calls: %s fails as %s", (schema, label) => {
    // Arrange
    const source = `${ZOD}\nexport const x = ${schema};\nexport const y = ${schema};`;

    // Act & Assert
    expect(bannedCallViolations(FILE, source)).toEqual([`${FILE}: ${label}`, `${FILE}: ${label} #2`]);
  });

  it("banned calls: plain structure passes, a field named transform included", () => {
    // Act & Assert
    expect(bannedCallViolations(FILE, PLAIN)).toEqual([]);
  });

  it("exports: a constant, a function, an interface and a non-z.input type fail", () => {
    // Arrange
    const source = [
      ZOD,
      "export const x = z.object({ name: z.string() });",
      'export const X_KINDS = ["a", "b"] as const;',
      "export function toX(name: string) { return { name }; }",
      "export interface XShape { name: string }",
      "export type XName = { name: string };",
      "export type XOut = z.output<typeof x>;",
    ].join("\n");

    // Act
    const violations = exportViolations(FILE, source, loadSource(source));

    // Assert
    expect(violations).toEqual([
      `${FILE}: X_KINDS is not a zod schema`,
      `${FILE}: toX is not a zod schema`,
      `${FILE}: type XName is not a z.input alias`,
      `${FILE}: type XOut is not a z.input alias`,
      `${FILE}: type XShape is not a z.input alias`,
    ]);
  });

  it("exports: zod schemas and their z.input aliases pass", () => {
    // Act & Assert
    expect(exportViolations(FILE, PLAIN, loadSource(PLAIN))).toEqual([]);
  });

  it("export: a native date fails both modes and a transform fails the output mode", () => {
    // Arrange
    const source = [
      ZOD,
      "export const dated = z.object({ at: z.date() });",
      "export const counted = z.object({ name: z.string().transform((s) => s.length) });",
    ].join("\n");

    // Act
    const failures = exportFailures(FILE, loadSource(source));

    // Assert
    expect(failures).toEqual([
      expect.stringMatching(/^src\/x\/x\.wire\.ts#counted: output mode throws \(/),
      expect.stringMatching(/^src\/x\/x\.wire\.ts#dated: input mode throws \(/),
      expect.stringMatching(/^src\/x\/x\.wire\.ts#dated: output mode throws \(/),
    ]);
  });

  it("export: plain structure exports in both modes", () => {
    // Act & Assert
    expect(exportFailures(FILE, loadSource(PLAIN))).toEqual([]);
  });

  it("open objects: a strict object at any depth fails", () => {
    // Arrange
    const source = [
      ZOD,
      "export const x = z.object({ inner: z.strictObject({ a: z.string() }), list: z.array(z.object({}).strict()) });",
    ].join("\n");

    // Act
    const violations = closedObjectViolations(FILE, loadSource(source));

    // Assert
    expect(violations).toEqual([
      `${FILE}#x: additionalProperties false at #/properties/inner`,
      `${FILE}#x: additionalProperties false at #/properties/list/items`,
    ]);
  });

  it("open objects: z.object stays open in input mode", () => {
    // Act & Assert
    expect(closedObjectViolations(FILE, loadSource(PLAIN))).toEqual([]);
  });

  it("timestamps: an <event>At property that is not a date-time string fails", () => {
    // Arrange
    const source = [
      ZOD,
      "export const x = z.object({",
      "  sentAt: z.string(),",
      "  createdAt: z.number(),",
      "  nested: z.object({ updatedAt: z.string().nullable() }),",
      "});",
    ].join("\n");

    // Act
    const violations = timestampViolations(FILE, loadSource(source));

    // Assert
    expect(violations).toEqual([
      `${FILE}#x: #/properties/sentAt is not z.iso.datetime()`,
      `${FILE}#x: #/properties/createdAt is not z.iso.datetime()`,
      `${FILE}#x: #/properties/nested/properties/updatedAt is not z.iso.datetime()`,
    ]);
  });

  it("timestamps: an object named <event>At is a structured date, not an instant", () => {
    // Arrange
    const source = [
      ZOD,
      "export const x = z.object({",
      "  startAt: z.object({ date: z.string(), time: z.string().nullable() }).nullable(),",
      "  endAt: z.object({ date: z.string() }),",
      "});",
    ].join("\n");

    // Act & Assert
    expect(timestampViolations(FILE, loadSource(source))).toEqual([]);
  });

  it("timestamps: z.iso.datetime(), nullable or optional, passes, and a word ending in at is no instant", () => {
    // Act & Assert
    expect(timestampViolations(FILE, loadSource(PLAIN))).toEqual([]);
  });
});

describe("src/ wire files", () => {
  const files = sourceFiles().filter((f) => f.endsWith(".wire.ts"));
  const load = (file: string): WireExports => require(path.join(ROOT, file)) as WireExports;

  it("call nothing the JSON Schema export would drop", () => {
    // Act & Assert
    expect(files.flatMap((f) => bannedCallViolations(f, readSource(f)))).toEqual([]);
  });

  it("export only zod schemas and their z.input types", () => {
    // Act & Assert
    expect(files.flatMap((f) => exportViolations(f, readSource(f), load(f)))).toEqual([]);
  });

  it("export to draft-07 JSON Schema in input and output mode", () => {
    // Act & Assert
    expect(files.flatMap((f) => exportFailures(f, load(f)))).toEqual([]);
  });

  it("publish open objects", () => {
    // Act & Assert
    expect(files.flatMap((f) => closedObjectViolations(f, load(f)))).toEqual([]);
  });

  it("send each instant as z.iso.datetime()", () => {
    // Act & Assert
    expect(files.flatMap((f) => timestampViolations(f, load(f)))).toEqual([]);
  });
});
