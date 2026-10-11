/**
 * The fixture-key walker (`__tests__/helpers/contracts/undeclared-keys.ts`)
 * reports every property a value carries that its JSON Schema does not
 * declare, through objects, arrays, tuples, records and unions, and nothing
 * for a value the schema fully declares.
 */
import { z } from "zod";
import { undeclaredKeys } from "../helpers/contracts/undeclared-keys";

const jsonOf = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", target: "draft-7" });

describe("undeclared keys", () => {
  const item = z.object({ name: z.string(), tags: z.array(z.object({ label: z.string() })) });

  it("are none when every property is declared, an absent optional one included", () => {
    // Arrange
    const schema = jsonOf(z.object({ items: z.array(item), note: z.string().optional() }));

    // Act & Assert
    expect(undeclaredKeys(schema, { items: [{ name: "a", tags: [{ label: "x" }] }] })).toEqual([]);
  });

  it("are reported by path at the top, in a nested object and inside array items", () => {
    // Arrange
    const schema = jsonOf(z.object({ items: z.array(item) }));
    const value = { extra: 1, items: [{ name: "a", tags: [] }, { name: "b", tags: [{ label: "x", color: "red" }], rank: 2 }] };

    // Act & Assert
    expect(undeclaredKeys(schema, value)).toEqual(["$.extra", "$.items[1].tags[0].color", "$.items[1].rank"]);
  });

  it("follow the tuple position and a root array", () => {
    // Arrange
    const schema = jsonOf(z.array(z.tuple([z.object({ a: z.string() }), z.number()])));

    // Act & Assert
    expect(undeclaredKeys(schema, [[{ a: "x", b: "y" }, 1]])).toEqual(["$[0][0].b"]);
  });

  it("take the member of a discriminated union the value matches", () => {
    // Arrange
    const schema = jsonOf(
      z.object({
        action: z.discriminatedUnion("type", [
          z.object({ type: z.literal("route"), value: z.string() }),
          z.object({ type: z.literal("none") }),
        ]),
      }),
    );

    // Act & Assert
    expect(undeclaredKeys(schema, { action: { type: "route", value: "/x" } })).toEqual([]);
    expect(undeclaredKeys(schema, { action: { type: "route", value: "/x", label: "y" } })).toEqual(["$.action.label"]);
  });

  it("look inside a nullable object and skip its null member", () => {
    // Arrange
    const schema = jsonOf(z.object({ detail: z.object({ a: z.string() }).nullable() }));

    // Act & Assert
    expect(undeclaredKeys(schema, { detail: null })).toEqual([]);
    expect(undeclaredKeys(schema, { detail: { a: "x", b: "y" } })).toEqual(["$.detail.b"]);
  });

  it("count a record's or loose object's keys as declared, and check what is below them", () => {
    // Arrange
    const schema = jsonOf(
      z.object({
        counts: z.record(z.string(), z.object({ n: z.number() })),
        extensions: z.looseObject({}),
      }),
    );

    // Act & Assert
    expect(undeclaredKeys(schema, { counts: { hssc: { n: 1 } }, extensions: { any: 1 } })).toEqual([]);
    expect(undeclaredKeys(schema, { counts: { hssc: { n: 1, m: 2 } }, extensions: {} })).toEqual(["$.counts.hssc.m"]);
  });

  it("report the keys of an object under a schema that declares none", () => {
    // Arrange
    const schema = jsonOf(z.object({ extensions: z.object({}), raw: z.unknown() }));

    // Act & Assert
    expect(undeclaredKeys(schema, { extensions: { a: 1 }, raw: { b: 2 } })).toEqual(["$.extensions.a", "$.raw.b"]);
  });
});
