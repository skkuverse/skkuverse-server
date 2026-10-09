import { isRecord } from "./object.util";

describe("isRecord", () => {
  it.each([{}, { a: 1 }, Object.create(null)])("accepts %p", (value) => {
    expect(isRecord(value)).toBe(true);
  });

  it.each([null, undefined, [], [1], "x", 1, true])("rejects %p", (value) => {
    expect(isRecord(value)).toBe(false);
  });
});
