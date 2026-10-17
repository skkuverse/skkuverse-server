/**
 * cafeteriaListQuery: the campus is required and is one of building's two
 * campus codes; anything else fails with the message the route answers.
 */
import { cafeteriaListQuery } from "./meals-catalog.schema";

describe("cafeteriaListQuery", () => {
  it.each(["hssc", "nsc"])("takes campus %s", (campus) => {
    // Act
    const parsed = cafeteriaListQuery.safeParse({ campus });

    // Assert
    expect(parsed.data).toEqual({ campus });
  });

  it.each<[string, Record<string, unknown>]>([
    ["no campus", {}],
    ["an empty campus", { campus: "" }],
    ["an unknown campus", { campus: "seoul" }],
    ["a repeated campus", { campus: ["hssc", "nsc"] }],
  ])("rejects %s", (_case, query) => {
    // Act
    const parsed = cafeteriaListQuery.safeParse(query);

    // Assert
    expect(parsed.error?.issues[0]?.message).toBe("campus must be 'hssc' or 'nsc'");
  });
});
