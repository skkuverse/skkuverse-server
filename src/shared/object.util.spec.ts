/** isRecord accepts a non-null, non-array object and nothing else. */
import { isRecord } from "./object.util";

describe("isRecord", () => {
  it.each([{}, { a: 1 }, Object.create(null)])("accepts %p", (value) => {
    // Act & Assert
    expect(isRecord(value)).toBe(true);
  });

  it.each([null, undefined, [], [1], "x", 1, true])("rejects %p", (value) => {
    // Act & Assert
    expect(isRecord(value)).toBe(false);
  });
});
