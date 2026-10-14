/**
 * presentationFor: a place's category picks its row in the layer set's
 * category table, and anything else, a prototype member's name included,
 * takes the fallback.
 */
import { presentationFor } from "./map.rules";

const TABLE = { itemDefaults: { byCategory: { booth: "booth row" }, fallback: "fallback row" } };

describe("presentationFor", () => {
  it.each([
    ["booth", "booth row"],
    ["bar", "fallback row"],
    ["constructor", "fallback row"],
    ["", "fallback row"],
  ])("reads category %j as %p", (category, row) => {
    // Act & Assert
    expect(presentationFor(TABLE, category)).toBe(row);
  });
});
