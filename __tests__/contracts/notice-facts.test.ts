/**
 * The server's zod mirror of the crawler's `facts` record against the vendored JSON Schema
 * (contracts/consumed/notice-facts.schema.json, ADR 0010 D13).
 *
 * The writer is strict and the server reads open, so the two are compared where drift would hurt a reader and left
 * alone where the reader is meant to tolerate it. At every object, array item and value:
 *
 *   - the required keys are the same set: a key the crawler now always writes is one the mirror hands to the code, and a
 *     key the mirror requires is one the crawler still writes;
 *   - a key the mirror declares exists in the vendored schema: a rename or removal upstream shows here;
 *   - an enum or constant holds the same values: a new value upstream would otherwise turn every record that carries
 *     it into null;
 *   - the JSON type is the same.
 *
 * A key only the vendored schema has is not a difference: the mirror strips it (an optional key the crawler adds
 * without a version bump), and a required one is already caught by the first line. So the optional keys the row and
 * the screen read, the table `label` and the `compact`, are pinned by path below, with the `compacts` mark.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import { noticeFacts } from "../../src/notices/facts/notices-facts.schema";

type JsonNode = Record<string, unknown>;

export interface Shape {
  type?: string;
  required: string[];
  properties: Record<string, Shape>;
  items?: Shape;
  values?: string[];
}

const asNode = (value: unknown): JsonNode => (typeof value === "object" && value !== null ? (value as JsonNode) : {});
const isNullBranch = (node: JsonNode): boolean => node.type === "null";

/** The `$defs` entry a local `$ref` names, or the node itself. */
function resolveRef(node: JsonNode, defs: JsonNode): JsonNode {
  const ref = typeof node.$ref === "string" ? /^#\/\$defs\/(.+)$/.exec(node.$ref)?.[1] : undefined;
  return ref === undefined ? node : asNode(defs[ref]);
}

/** The JSON type without `null` (a nullable field is the same field), with `integer` read as `number`. */
function typeOf(node: JsonNode): string | undefined {
  const types = (Array.isArray(node.type) ? node.type : [node.type]).filter((t): t is string => typeof t === "string" && t !== "null");
  return types.length === 0 ? undefined : types[0] === "integer" ? "number" : types[0];
}

/**
 * The comparable shape of a JSON Schema node, either the vendored schema or what `z.toJSONSchema` makes of the mirror:
 * `$ref` followed, `null` left out of a nullable's union, `const` read as a one-value enum.
 */
export function shapeOf(node: JsonNode, defs: JsonNode = asNode(node.$defs)): Shape {
  const own = resolveRef(node, defs);
  const union = [own.anyOf, own.oneOf].find(Array.isArray) as unknown[] | undefined;
  if (union) {
    const branches = union.map(asNode).filter((b) => !isNullBranch(b));
    if (branches.length === 1) return shapeOf(branches[0]!, defs);
  }
  const properties = Object.fromEntries(Object.entries(asNode(own.properties)).map(([key, value]) => [key, shapeOf(asNode(value), defs)]));
  const values = Array.isArray(own.enum) ? own.enum.filter((v) => v !== null) : "const" in own ? [own.const] : undefined;
  return {
    type: typeOf(own),
    required: [...((own.required as string[] | undefined) ?? [])].sort(),
    properties,
    ...(own.items === undefined ? {} : { items: shapeOf(asNode(own.items), defs) }),
    ...(values === undefined ? {} : { values: values.map((v) => JSON.stringify(v)).sort() }),
  };
}

const listOf = (keys: string[]): string => keys.join(", ");

/** `<path>: <what differs>` for each way the mirror departs from the vendored schema, in path order. */
export function shapeDifferences(vendored: Shape, mirror: Shape, at = "$"): string[] {
  const out: string[] = [];
  if (vendored.type !== undefined && mirror.type !== undefined && vendored.type !== mirror.type) {
    out.push(`${at}: type ${mirror.type} in the mirror, ${vendored.type} in the vendored schema`);
  }
  const vendoredOnly = vendored.required.filter((key) => !mirror.required.includes(key));
  const mirrorOnly = mirror.required.filter((key) => !vendored.required.includes(key));
  if (vendoredOnly.length > 0) out.push(`${at}: required in the vendored schema only: ${listOf(vendoredOnly)}`);
  if (mirrorOnly.length > 0) out.push(`${at}: required in the mirror only: ${listOf(mirrorOnly)}`);
  if (vendored.values && mirror.values && listOf(vendored.values) !== listOf(mirror.values)) {
    out.push(`${at}: values ${listOf(mirror.values)} in the mirror, ${listOf(vendored.values)} in the vendored schema`);
  }
  for (const [key, shape] of Object.entries(mirror.properties)) {
    const upstream = vendored.properties[key];
    if (upstream === undefined) out.push(`${at}.${key}: declared by the mirror, absent from the vendored schema`);
    else out.push(...shapeDifferences(upstream, shape, `${at}.${key}`));
  }
  if (vendored.items && mirror.items) out.push(...shapeDifferences(vendored.items, mirror.items, `${at}[]`));
  return out;
}

const VENDORED_FILE = path.join(__dirname, "../../contracts/consumed/notice-facts.schema.json");
const vendored = JSON.parse(fs.readFileSync(VENDORED_FILE, "utf8")) as JsonNode;
const mirrorShape = (): Shape => shapeOf(z.toJSONSchema(noticeFacts, { io: "output", unrepresentable: "any" }) as JsonNode);

describe("the notice facts mirror", () => {
  it("agrees with the vendored schema on required keys, declared keys, enums and types", () => {
    // Act
    const differences = shapeDifferences(shapeOf(vendored), mirrorShape());

    // Assert
    expect(differences).toEqual([]);
  });

  it("is checked at depth: the vendored schema has the nested objects the comparison walks", () => {
    // Arrange
    const shape = shapeOf(vendored);

    // Act & Assert
    expect(shape.required).toContain("things");
    expect(shape.properties.things?.items?.properties.name?.required).toEqual(["end", "match", "quote", "src", "start"]);
    expect(shape.properties.times?.items?.properties.start?.required).toContain("latest");
  });
});

/** The node at a path of property names, `[]` stepping into an array's items. */
const nodeAt = (shape: Shape, keys: string[]): Shape | undefined =>
  keys.reduce<Shape | undefined>((node, key) => (key === "[]" ? node?.items : node?.properties[key]), shape);

describe("the notice facts mirror reads the table label of codebook v3.11", () => {
  const LABEL_PATHS: Array<[string, string[]]> = [
    ["a condition's quote", ["audience", "conditions", "[]", "ev", "label"]],
    ["a benefit's quote", ["benefits", "[]", "ev", "label"]],
    ["a cost of missing", ["costOfMissing", "[]", "label"]],
  ];

  it.each(LABEL_PATHS)("has an optional text label on %s, in the vendored schema and in the mirror", (_what, keys) => {
    // Arrange
    const [vendoredShape, mirror] = [shapeOf(vendored), mirrorShape()];
    const parent = keys.slice(0, -1);

    // Act
    const [upstreamLabel, mirrorLabel] = [nodeAt(vendoredShape, keys), nodeAt(mirror, keys)];

    // Assert
    expect(upstreamLabel?.type).toBe("string");
    expect(mirrorLabel?.type).toBe("string");
    expect(nodeAt(vendoredShape, parent)?.required).not.toContain("label");
    expect(nodeAt(mirror, parent)?.required).not.toContain("label");
  });
});

describe("the notice facts mirror reads the compact of the crawler's ADR 015 decision 25", () => {
  const COMPACT_PATHS: Array<[string, string[]]> = [
    ["a condition's quote", ["audience", "conditions", "[]", "ev", "compact"]],
    ["a benefit's quote", ["benefits", "[]", "ev", "compact"]],
    ["a cost of missing", ["costOfMissing", "[]", "compact"]],
    ["the words that make a notice not for students", ["audience", "forStudentsEv", "compact"]],
    ["a place's text", ["times", "[]", "where", "places", "[]", "compact"]],
  ];

  it.each(COMPACT_PATHS)("has an optional text compact on %s, in the vendored schema and in the mirror", (_what, keys) => {
    // Arrange
    const [vendoredShape, mirror] = [shapeOf(vendored), mirrorShape()];
    const parent = keys.slice(0, -1);

    // Act
    const [upstreamCompact, mirrorCompact] = [nodeAt(vendoredShape, keys), nodeAt(mirror, keys)];

    // Assert
    expect(upstreamCompact?.type).toBe("string");
    expect(mirrorCompact?.type).toBe("string");
    expect(nodeAt(vendoredShape, parent)?.required).not.toContain("compact");
    expect(nodeAt(mirror, parent)?.required).not.toContain("compact");
  });

  it("has an optional text label on the words that make a notice not for students, which now share a condition's evidence", () => {
    // Arrange
    const keys = ["audience", "forStudentsEv", "label"];
    const [vendoredShape, mirror] = [shapeOf(vendored), mirrorShape()];

    // Act & Assert
    expect(nodeAt(vendoredShape, keys)?.type).toBe("string");
    expect(nodeAt(mirror, keys)?.type).toBe("string");
  });

  it("has the optional compacts mark with the same three keys, in the vendored schema and in the mirror", () => {
    // Arrange
    const [vendoredShape, mirror] = [shapeOf(vendored), mirrorShape()];
    const [upstreamMark, mirrorMark] = [vendoredShape.properties.compacts, mirror.properties.compacts];

    // Act & Assert
    expect(upstreamMark?.type).toBe("object");
    expect(Object.keys(upstreamMark?.properties ?? {}).sort()).toEqual(["models", "promptVersion", "stored"]);
    expect(mirrorMark?.type).toBe("object");
    expect(Object.keys(mirrorMark?.properties ?? {}).sort()).toEqual(["models", "promptVersion", "stored"]);
    expect(vendoredShape.required).not.toContain("compacts");
    expect(mirror.required).not.toContain("compacts");
  });
});

describe("shape comparison applies as specified", () => {
  const VENDORED = {
    $defs: { ev: { type: "object", properties: { quote: { type: "string" } }, required: ["quote"] } },
    type: "object",
    properties: {
      v: { type: "integer", const: 1 },
      kind: { type: "string", enum: ["a", "b"] },
      note: { oneOf: [{ $ref: "#/$defs/ev" }, { type: "null" }] },
      mode: { type: ["string", "null"], enum: ["x", null] },
      rows: { type: "array", items: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    },
    required: ["v", "kind", "note"],
  };
  const mirrorOf = (schema: z.ZodType): Shape => shapeOf(z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as JsonNode);
  const ev = z.object({ quote: z.string() });
  const MIRROR = z.object({
    v: z.literal(1),
    kind: z.enum(["a", "b"]),
    note: ev.nullable(),
    mode: z.enum(["x"]).nullable().optional(),
    rows: z.array(z.object({ id: z.string() })).optional(),
  });

  it("finds no difference between a vendored schema and a mirror that follows it", () => {
    // Act & Assert
    expect(shapeDifferences(shapeOf(VENDORED), mirrorOf(MIRROR))).toEqual([]);
  });

  it("tolerates a vendored key the mirror strips, and a nullable the vendored schema writes as a union", () => {
    // Arrange
    const withNewKey = { ...VENDORED, properties: { ...VENDORED.properties, added: { type: "string" } } };

    // Act & Assert
    expect(shapeDifferences(shapeOf(withNewKey), mirrorOf(MIRROR))).toEqual([]);
  });

  it.each([
    ["a key the mirror leaves optional", z.object({ v: z.literal(1), kind: z.enum(["a", "b"]), note: ev.nullable().optional() }), "$: required in the vendored schema only: note"],
    ["a key the mirror requires too much", MIRROR.extend({ mode: z.enum(["x"]).nullable() }), "$: required in the mirror only: mode"],
    ["a key the mirror renamed", MIRROR.extend({ kinds: z.string().optional() }), "$.kinds: declared by the mirror, absent from the vendored schema"],
    ["an enum value upstream added", MIRROR.extend({ kind: z.enum(["a"]) }), "$.kind: values \"a\" in the mirror, \"a\", \"b\" in the vendored schema"],
    ["a version the mirror does not pin", MIRROR.extend({ v: z.literal(2) }), "$.v: values 2 in the mirror, 1 in the vendored schema"],
    ["a type that changed", MIRROR.extend({ kind: z.number() }), "$.kind: type number in the mirror, string in the vendored schema"],
    ["a nested key left optional", MIRROR.extend({ rows: z.array(z.object({ id: z.string().optional() })).optional() }), "$.rows[]: required in the vendored schema only: id"],
    ["a nested object followed through a reference", MIRROR.extend({ note: z.object({ quote: z.string().optional() }).nullable() }), "$.note: required in the vendored schema only: quote"],
  ])("reports %s", (_label, schema, expected) => {
    // Act
    const differences = shapeDifferences(shapeOf(VENDORED), mirrorOf(schema));

    // Assert
    expect(differences).toContain(expected);
  });
});
