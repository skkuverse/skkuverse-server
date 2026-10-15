/**
 * A structure pin (tests.md): the Mongo the list read sends. The page filter for the notice-list cursor
 * (skkuverse#52, ADR 0007) pages on (date, _id) only: `crawledAt` must not appear in the filter, or rows that
 * share a date flip between ticks, since the crawler rewrites it every 30 minutes.
 */

import { ObjectId } from "mongodb";
import { toCursorFilter } from "./notices-list.query";

const OID = "66a1b2c3d4e5f6a7b8c9d0e1";
const ISO = "2026-04-01T00:00:00.000Z";

describe("toCursorFilter", () => {
  it("pages on (date, _id) only — never on crawledAt", () => {
    // Act
    const filter = toCursorFilter({ d: "2026-04-01", c: ISO, i: OID });

    // Assert
    expect(filter).toEqual({
      $or: [
        { date: { $lt: "2026-04-01" } },
        { date: "2026-04-01", _id: { $lt: new ObjectId(OID) } },
      ],
    });
    // Belt and braces: a future edit that reintroduces the key anywhere in
    // the filter tree reopens the ordering flip, so assert on the whole shape.
    expect(JSON.stringify(filter)).not.toContain("crawledAt");
  });

  it("ignores a legacy `c` rather than letting it narrow the page", () => {
    // Arrange
    const withC = toCursorFilter({ d: "2026-04-01", c: ISO, i: OID });

    // Act
    const withoutC = toCursorFilter({ d: "2026-04-01", i: OID });

    // Assert
    expect(withC).toEqual(withoutC);
  });
});
