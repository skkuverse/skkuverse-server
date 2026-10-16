/**
 * toSyncYears, the years one calendar sync fetches: the KST year of the
 * instant and the year after it. Checked at the turn of the year, where the
 * UTC and KST years differ for nine hours.
 */
import { toSyncYears } from "./holidays-sync.rules";

describe("toSyncYears", () => {
  it.each([
    ["the last instant of 2026 in KST", "2026-12-31T14:59:59.999Z", [2026, 2027]],
    ["the first instant of 2027 in KST, still 2026 in UTC", "2026-12-31T15:00:00Z", [2027, 2028]],
    ["one second into 2027 in KST", "2026-12-31T15:00:01Z", [2027, 2028]],
    ["mid-year", "2026-10-16T03:00:00Z", [2026, 2027]],
  ])("syncs this year and next at %s", (_label, instant, years) => {
    // Act & Assert
    expect(toSyncYears(new Date(instant))).toEqual(years);
  });

  it("does not answer the UTC year at 01:30 KST on New Year's Day", () => {
    // Act & Assert
    expect(toSyncYears(new Date("2026-12-31T16:30:00Z"))).not.toContain(2026);
  });
});
