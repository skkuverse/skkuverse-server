/**
 * The text normalization the list and detail mappers share: an empty or missing text is served as null, any
 * other text as it is.
 */
import { textOrNull } from "./notices.mapper";

describe("textOrNull", () => {
  it.each([
    ["", null],
    [null, null],
    [undefined, null],
    [" ", " "],
    ["학부통합(학사)", "학부통합(학사)"],
  ])("%j → %j", (value, expected) => {
    // Act & Assert
    expect(textOrNull(value)).toBe(expected);
  });
});
