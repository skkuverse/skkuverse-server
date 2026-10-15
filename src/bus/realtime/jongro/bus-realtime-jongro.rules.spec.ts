/**
 * The Jongro rules: which TOPIS header codes carry data, the dwell timer at a
 * stop (reset after 10 minutes) at each threshold, and the drift between
 * TOPIS's stop list and jongro-routes.json, named stop by stop.
 */
import { jongroRoutes } from "../../bus.config";
import type { JongroArrivalDoc } from "../../cache/bus-cache.document";
import { isNoResultHeaderCd, isUsableHeaderCd, toArrivalsKey, toDwell, toPositionsKey, toRegistryDrift } from "./bus-realtime-jongro.rules";

const NOW = new Date("2026-10-20T01:00:00Z");
const minutesBefore = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const route07 = jongroRoutes.find((r) => r.code === "07")!;

// What TOPIS would return when it matches the registry exactly: one row per ord.
const topisList = (): JongroArrivalDoc[] =>
  route07.topisIds.map((stationId, idx) => ({
    stationId,
    sequence: String(idx + 1),
    stationName: route07.stations[idx]!.stationName,
    stationNumber: "",
    carNumber: "----",
    eventDate: "",
    eta: "",
  }));

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

describe("toRegistryDrift", () => {
  it("is null when TOPIS lists exactly the registry stops", () => {
    // Act & Assert
    expect(toRegistryDrift(route07, topisList())).toBeNull();
  });

  it("names reordered stops by ord", () => {
    // Arrange
    const list = topisList();
    const [a, b] = [list[0]!, list[1]!];

    // Act
    const drift = toRegistryDrift(route07, [{ ...b, sequence: "1" }, { ...a, sequence: "2" }, ...list.slice(2)]);

    // Assert
    expect(drift).toMatchObject({
      mismatched: [
        { staOrd: "1", stId: b.stationId, expected: a.stationId },
        { staOrd: "2", stId: a.stationId, expected: b.stationId },
      ],
      missing: [],
    });
  });

  it("names registry ords that TOPIS no longer lists", () => {
    // Act & Assert
    expect(toRegistryDrift(route07, topisList().slice(0, -1))).toMatchObject({
      mismatched: [],
      missing: [{ staOrd: "22", topisId: "100900219", stationName: "600주년기념관" }],
    });
  });

  it("names renamed stops", () => {
    // Arrange
    const list = topisList();

    // Act & Assert
    expect(toRegistryDrift(route07, [{ ...list[0]!, stationName: "새이름" }, ...list.slice(1)])).toMatchObject({
      mismatched: [],
      missing: [],
      renamed: [{ staOrd: "1", stNm: "새이름", registryName: "성균관대운동장" }],
    });
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
