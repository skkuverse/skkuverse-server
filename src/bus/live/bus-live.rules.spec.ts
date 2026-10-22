/**
 * A live group's operation from its stations' (ADR 0019, D8): ended when every station's is, running when
 * any is, and noData when the source stated nothing or nothing but no data.
 */
import { toGroupOperation } from "./bus-live.rules";

describe("toGroupOperation", () => {
  it.each([
    [[], "noData"],
    [["ended", "ended"], "ended"],
    [["ended", "running"], "running"],
    [["noData", "running"], "running"],
    [["noData", "noData"], "noData"],
    [["ended", "noData"], "noData"],
  ] as const)("stations %j → %s", (operations, expected) => {
    // Act & Assert
    expect(toGroupOperation(operations.map((operation) => ({ operation })))).toBe(expected);
  });
});
