/**
 * cafeteriaCampus, the campus every meals route takes: one of building's two
 * campus codes, and anything else fails with the message the routes answer
 * under INVALID_CAMPUS.
 */
import { cafeteriaCampus } from "./meals.schema";

describe("cafeteriaCampus", () => {
  it.each(["hssc", "nsc"])("takes %s", (campus) => {
    // Act
    const parsed = cafeteriaCampus.safeParse(campus);

    // Assert
    expect(parsed.data).toBe(campus);
  });

  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["an empty string", ""],
    ["an unknown campus", "seoul"],
    ["a list", ["hssc"]],
  ])("rejects %s", (_case, value) => {
    // Act
    const parsed = cafeteriaCampus.safeParse(value);

    // Assert
    expect(parsed.error?.issues[0]?.message).toBe("campus must be 'hssc' or 'nsc'");
  });
});
