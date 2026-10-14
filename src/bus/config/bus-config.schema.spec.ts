/**
 * busGroupVisibility: always, or a KST date range whose `until` is not before
 * its `from`, with an optional HH:mm `fromTime`; anything else is refused.
 */
import { busGroupVisibility } from "./bus-config.schema";

describe("busGroupVisibility", () => {
  it.each([
    [{ type: "always" }, true],
    [{ type: "dateRange", from: "2026-10-12", until: "2026-12-18" }, true],
    [{ type: "dateRange", from: "2026-10-12", fromTime: "11:55", until: "2026-12-18" }, true],
    [{ type: "dateRange", from: "2026-12-18", until: "2026-10-12" }, false],
    [{ type: "dateRange", from: "2026-10-12", fromTime: "24:00", until: "2026-12-18" }, false],
    [{ type: "always", from: "2026-10-12" }, false],
    [{ type: "sometimes" }, false],
  ])("%j → %s", (visibility, expected) => {
    // Act & Assert
    expect(busGroupVisibility.safeParse(visibility).success).toBe(expected);
  });
});
