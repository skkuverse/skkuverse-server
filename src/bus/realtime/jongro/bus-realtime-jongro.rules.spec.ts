/**
 * The Jongro rules: which TOPIS header codes carry data, which of TOPIS's
 * strings read as a number, the dwell timer at a
 * stop (reset after 10 minutes) at each threshold, and the cache keys.
 */
import {
  isNoResultHeaderCd,
  isUsableHeaderCd,
  toArrivalsKey,
  toDwell,
  toPositionsKey,
  toTopisInteger,
} from "./bus-realtime-jongro.rules";
import { jongroRoutes } from "../../bus.config";

const NOW = new Date("2026-10-20T01:00:00Z");
const route07 = jongroRoutes.find((r) => r.code === "07")!;
const minutesBefore = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe("isUsableHeaderCd", () => {
  it.each([
    [undefined, true],
    ["0", true],
    ["4", true],
    ["7", false],
    ["8", false],
  ])("%s → %s", (headerCd, expected) => {
    // Act & Assert
    expect(isUsableHeaderCd(headerCd)).toBe(expected);
  });
});

describe("isNoResultHeaderCd", () => {
  it.each([
    [undefined, false],
    ["0", false],
    ["4", true],
    ["7", false],
  ])("%s → %s", (headerCd, expected) => {
    // Act & Assert
    expect(isNoResultHeaderCd(headerCd)).toBe(expected);
  });
});

describe("toTopisInteger", () => {
  it.each([
    ["228", 228],
    ["0", 0],
    [" 7 ", 7],
    ["-3", -3],
    ["", null],
    [" ", null],
    ["12.5", null],
    ["2분", null],
    [null, null],
    [undefined, null],
  ])("%j → %j", (text, expected) => {
    // Act & Assert
    expect(toTopisInteger(text)).toBe(expected);
  });
});

describe("toDwell", () => {
  it("starts a dwell at a stop no bus held", () => {
    // Act & Assert
    expect(toDwell(undefined, NOW)).toEqual({ firstSeenAt: NOW.toISOString(), dwellSeconds: 0 });
  });

  it.each([
    [9, { firstSeenAt: minutesBefore(9), dwellSeconds: 540 }],
    [10, { firstSeenAt: minutesBefore(10), dwellSeconds: 600 }],
    [11, { firstSeenAt: NOW.toISOString(), dwellSeconds: 0 }],
  ])("a stop held %i minutes → %j", (minutes, expected) => {
    // Act & Assert
    expect(toDwell(minutesBefore(minutes), NOW)).toEqual(expected);
  });
});

// WHY: the poller writes and every replica reads these keys, so a route's two keys are built in one place
// from its two-digit code, never from its id (`jongro07`).
describe("toArrivalsKey", () => {
  it("keys a route's arrivals by its code", () => {
    // Act & Assert
    expect(toArrivalsKey(route07.code)).toBe("jongro_stations_07");
  });
});

describe("toPositionsKey", () => {
  it("keys a route's positions by its code", () => {
    // Act & Assert
    expect(toPositionsKey(route07.code)).toBe("jongro_locations_07");
  });
});
