/**
 * shouldDeleteStaleCafeterias: when a sisulList run listed enough cafeterias
 * to trust its absences. Below MIN_CAFETERIAS_FOR_STALE_DELETE a short answer
 * from SKKU must never delete the cafeterias it left out; at or above it, the
 * run may.
 */
import { MIN_CAFETERIAS_FOR_STALE_DELETE, shouldDeleteStaleCafeterias } from "./building-cafeteria.rules";

describe("shouldDeleteStaleCafeterias", () => {
  it.each([
    [MIN_CAFETERIAS_FOR_STALE_DELETE - 1, false],
    [MIN_CAFETERIAS_FOR_STALE_DELETE, true],
    [MIN_CAFETERIAS_FOR_STALE_DELETE + 1, true],
    [0, false],
  ])("is %s listed → %s", (listedCount, expected) => {
    // Act & Assert
    expect(shouldDeleteStaleCafeterias(listedCount)).toBe(expected);
  });

  it("trusts today's registry, which lists 11 cafeterias", () => {
    // Act & Assert
    expect(shouldDeleteStaleCafeterias(11)).toBe(true);
  });
});
