/**
 * A route test's check that a response body is what its wire schema
 * publishes (define-boundary-contracts design D6): the body parses with the
 * schema, and the schema's input-mode JSON Schema declares every property the
 * body carries. Pass the envelope's `data` (or its `meta`), not the envelope.
 */
import { z } from "zod";
import { undeclaredKeys } from "./undeclared-keys";

/** Throws unless `body` parses with `schema` and carries no property `schema` leaves undeclared. */
export function expectWire(schema: z.ZodType, body: unknown): void {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`[contracts] the body does not parse with its wire schema:\n${z.prettifyError(parsed.error)}`);
  }
  const undeclared = undeclaredKeys(z.toJSONSchema(schema, { io: "input", target: "draft-7" }), body);
  if (undeclared.length > 0) {
    throw new Error(
      [
        "[contracts] the body carries properties its wire schema does not declare; add them to the .wire schema:",
        ...undeclared.map((p) => `  - ${p}`),
      ].join("\n"),
    );
  }
}
