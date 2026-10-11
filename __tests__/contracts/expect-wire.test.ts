/**
 * `expectWire(schema, body)` (`__tests__/helpers/contracts/expect-wire.ts`)
 * passes a body that parses with its wire schema and carries only declared
 * properties, and fails, naming the reason, a body that does not parse or
 * carries a property the schema does not publish.
 */
import { z } from "zod";
import { expectWire } from "../helpers/contracts/expect-wire";

describe("expectWire", () => {
  const schema = z.object({ items: z.array(z.object({ name: z.string(), sentAt: z.iso.datetime().optional() })) });

  it("passes a body the schema parses and fully declares", () => {
    // Arrange
    const body = { items: [{ name: "a" }, { name: "b", sentAt: "2026-10-11T00:00:00.000Z" }] };

    // Act & Assert
    expect(() => expectWire(schema, body)).not.toThrow();
  });

  it("fails a body that does not parse, naming the path", () => {
    // Arrange
    const body = { items: [{ name: 1 }] };

    // Act & Assert
    expect(() => expectWire(schema, body)).toThrow(/does not parse with its wire schema[\s\S]*items\[0\]\.name/);
  });

  it("fails a body with a property the schema does not declare, naming its path", () => {
    // Arrange
    const body = { items: [{ name: "a", rank: 1 }], total: 1 };

    // Act & Assert
    expect(() => expectWire(schema, body)).toThrow(/does not declare[\s\S]*\$\.items\[0\]\.rank[\s\S]*\$\.total/);
  });
});
