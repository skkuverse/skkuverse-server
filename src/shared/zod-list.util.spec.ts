/**
 * issuePaths names where a parse failed, each path once; parseEach keeps every item that parses, as
 * parsed, and names every item that does not by its key and issue paths, both in input order.
 */
import { z } from "zod";
import { issuePaths, parseEach } from "./zod-list.util";

function failedAt(...paths: PropertyKey[][]): z.ZodError {
  return new z.ZodError(paths.map((path) => ({ code: "custom" as const, path, message: "bad", input: null })));
}

const item = z.object({ id: z.string(), floor: z.number() });

const idOf = (raw: unknown): string => String((raw as { id: unknown }).id);

describe("issuePaths", () => {
  it("names an issue on the value itself (root)", () => {
    // Arrange
    const error = failedAt([]);

    // Act & Assert
    expect(issuePaths(error)).toBe("(root)");
  });

  it("joins a nested path with dots", () => {
    // Arrange
    const error = failedAt(["spaceList", 0, "spaceCd"]);

    // Act & Assert
    expect(issuePaths(error)).toBe("spaceList.0.spaceCd");
  });

  it("lists each path once, in the order first seen", () => {
    // Arrange
    const error = failedAt(["z"], ["a"], ["z"], [], ["a"], []);

    // Act & Assert
    expect(issuePaths(error)).toBe("z, a, (root)");
  });
});

describe("parseEach", () => {
  it("keeps the valid items and names the invalid ones, each list in input order", () => {
    // Arrange
    const items = [
      { id: "v1", floor: 1 },
      { id: "x1", floor: "2" },
      { id: "v2", floor: 3 },
      { id: "x2" },
      { id: "v3", floor: 5 },
    ];

    // Act
    const result = parseEach(items, item, idOf);

    // Assert
    expect(result).toEqual({
      valid: [
        { id: "v1", floor: 1 },
        { id: "v2", floor: 3 },
        { id: "v3", floor: 5 },
      ],
      invalid: ["x1: floor", "x2: floor"],
    });
  });

  it("passes keyOf the raw item and its zero-based index", () => {
    // Arrange
    const keyOf = jest.fn((raw: unknown, index: number) => `#${index}`);
    const bad = { id: 7 };

    // Act
    const { invalid } = parseEach([{ id: "a", floor: 0 }, bad, "row"], item, keyOf);

    // Assert
    expect(invalid).toEqual(["#1: id, floor", "#2: (root)"]);
    expect(keyOf).toHaveBeenNthCalledWith(1, bad, 1);
  });

  it("returns the schema's output, transforms applied, not the raw item", () => {
    // Arrange
    const labelled = item.transform(({ id, floor }) => ({ label: `${id}@${floor}F` }));

    // Act
    const { valid } = parseEach([{ id: "lib", floor: 2 }], labelled, idOf);

    // Assert
    expect(valid).toEqual([{ label: "lib@2F" }]);
  });

  it("returns two empty lists for no items", () => {
    // Act & Assert
    expect(parseEach([], item, idOf)).toEqual({ valid: [], invalid: [] });
  });
});
