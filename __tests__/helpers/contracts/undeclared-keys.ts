/**
 * The closed-world check behind the golden fixtures (ADR 0010, D13): a published schema is open for consumers, but every property
 * the server really sends must be declared in it. This walks a value against
 * its JSON Schema through `properties`, `items` and `anyOf`/`oneOf`, and
 * reports each property no schema declares.
 *
 * A key is declared by `properties`, or by an `additionalProperties` schema:
 * a `z.record` or a `z.looseObject`. An `anyOf`/`oneOf` member counts only
 * when its `type` admits the value, and the member that leaves the fewest
 * keys undeclared decides, as a discriminated union's matching branch does.
 */

type Schema = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function jsonTypes(value: unknown): string[] {
  if (value === null) return ["null"];
  if (Array.isArray(value)) return ["array"];
  if (typeof value === "number") return Number.isInteger(value) ? ["integer", "number"] : ["number"];
  return [typeof value];
}

function admits(schema: Schema, value: unknown): boolean {
  if (schema.type === undefined) return true;
  const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
  return jsonTypes(value).some((t) => allowed.includes(t));
}

/** `$.a.b[0].c` for each property of `value` that `schema` does not declare. */
export function undeclaredKeys(schema: unknown, value: unknown, at = "$"): string[] {
  if (!isRecord(schema)) return [];
  const members = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : undefined;
  if (members) {
    const candidates = members
      .filter(isRecord)
      .filter((m) => admits(m, value))
      .map((m) => undeclaredKeys(m, value, at));
    return candidates.reduce<string[] | undefined>((best, c) => (best === undefined || c.length < best.length ? c : best), undefined) ?? [];
  }
  if (Array.isArray(value)) {
    const items = schema.items;
    return value.flatMap((item, i) => undeclaredKeys(Array.isArray(items) ? items[i] : items, item, `${at}[${i}]`));
  }
  if (!isRecord(value)) return [];
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const rest = schema.additionalProperties;
  return Object.entries(value).flatMap(([key, child]) => {
    const where = `${at}.${key}`;
    if (Object.hasOwn(properties, key)) return undeclaredKeys(properties[key], child, where);
    if (isRecord(rest)) return undeclaredKeys(rest, child, where);
    return rest === true ? [] : [where];
  });
}
