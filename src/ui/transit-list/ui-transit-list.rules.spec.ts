/**
 * A bus group's card shows always, or from the first to the last day of its
 * date range, both whole days in KST. The instants below fall on different
 * dates in UTC and KST, so a check in the host's zone fails them.
 */
import { isBusGroupVisible } from "./ui-transit-list.rules";

const pilot = { type: "dateRange", from: "2026-10-20", until: "2026-12-18" } as const;

describe("isBusGroupVisible", () => {
  it("shows an always-visible group at any time", () => {
    // Act & Assert
    expect(isBusGroupVisible({ type: "always" }, new Date("2000-01-01T00:00:00Z"))).toBe(true);
  });

  it.each([
    ["2026-10-19T14:59:59.999Z", false],
    ["2026-10-19T15:00:00.000Z", true],
    ["2026-12-18T14:59:59.999Z", true],
    ["2026-12-18T15:00:00.000Z", false],
  ])("at %s (the KST date edge) answers %p", (iso, expected) => {
    // Act & Assert
    expect(isBusGroupVisible(pilot, new Date(iso))).toBe(expected);
  });
});
