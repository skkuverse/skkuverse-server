/**
 * accuracyQuery: the accuracy report's range is two KST service dates,
 * `YYYY-MM-DD`, both included, `from` not after `to`; anything else is refused
 * with an issue naming the field.
 */
import { accuracyQuery } from "./subway-history.schema";

const RANGE = { from: "2026-10-10", to: "2026-10-16" };

describe("accuracyQuery", () => {
  it.each([
    ["a week", RANGE],
    ["one day", { from: "2026-10-16", to: "2026-10-16" }],
  ])("passes %s as it is", (_label, query) => {
    // Act
    const parsed = accuracyQuery.safeParse(query);

    // Assert
    expect(parsed).toEqual({ success: true, data: query });
  });

  it.each(Object.keys(accuracyQuery.shape))("refuses a range missing %s", (field) => {
    // Arrange
    const query: Record<string, string> = { ...RANGE };
    delete query[field];

    // Act
    const parsed = accuracyQuery.safeParse(query);

    // Assert
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([field]);
  });

  it.each([
    ["an ISO instant", { ...RANGE, from: "2026-10-10T00:00:00Z" }, "from"],
    ["a date without dashes", { ...RANGE, to: "20261016" }, "to"],
    ["to before from", { from: "2026-10-16", to: "2026-10-15" }, "to"],
  ])("refuses %s", (_label, query, field) => {
    // Act
    const parsed = accuracyQuery.safeParse(query);

    // Assert
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([field]);
  });
});
