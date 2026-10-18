/**
 * The Jongro rules: which TOPIS header codes carry data, which of TOPIS's
 * strings read as a number, the dwell timer at a
 * stop (reset after 10 minutes) at each threshold, the cache keys, TOPIS's
 * observation time as a KST instant, and whether a bus stood still between
 * two observations (under 10 m), and whether it idles at its origin (at
 * index 0 with lastStTm 0, and not moved 10 m since the previous observation).
 */
import {
  isIdlingAtOrigin,
  isNoResultHeaderCd,
  isStationary,
  isUsableHeaderCd,
  toArrivalsKey,
  toDwell,
  toObservedAt,
  toPositionsKey,
  toTopisDecimal,
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

describe("toTopisDecimal", () => {
  it.each([
    ["0.043", 0.043],
    ["0", 0],
    [" 0.259 ", 0.259],
    ["12", 12],
    ["", null],
    ["0.04km", null],
    ["-0.1", null],
    [null, null],
    [undefined, null],
  ])("%j → %j", (text, expected) => {
    // Act & Assert
    expect(toTopisDecimal(text)).toBe(expected);
  });
});

// QUIRK(topis): getBusPosByRtid's dataTm is a KST wall clock with no offset (the 2026-10-17 capture).
describe("toObservedAt", () => {
  it.each([
    ["20261017191140", "2026-10-17T19:11:40+09:00"],
    ["20261019013000", "2026-10-19T01:30:00+09:00"],
    [" 20261017191140 ", "2026-10-17T19:11:40+09:00"],
    ["2026101719114", null],
    ["2026-10-17 19:11:40", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("%j → %j", (dataTm, expected) => {
    // Act & Assert
    expect(toObservedAt(dataTm)).toBe(expected);
  });

  it("names the KST instant, not the UTC wall clock", () => {
    // Act
    const observedAt = toObservedAt("20261020013000")!;

    // Assert
    expect(new Date(observedAt).toISOString()).toBe("2026-10-19T16:30:00.000Z");
    expect(new Date(observedAt).toISOString()).not.toBe("2026-10-20T01:30:00.000Z");
  });
});

// WHY: a bus idling at its origin reports stopFlag 0 (add-jongro-bus-positions D3), so standing still is judged
// from two observations of the same vehicle.
describe("isStationary", () => {
  const observation = { sectOrd: 1, sectDist: 0.043, observedAt: "2026-10-17T19:11:40+09:00", isStationary: false };
  const LATER = "2026-10-17T19:11:58+09:00";

  it("is false for a vehicle not observed before, as after a poller restart", () => {
    // Act & Assert
    expect(isStationary(undefined, { sectOrd: 1, sectDist: 0.043, observedAt: LATER })).toBe(false);
  });

  it.each([
    [0.043, true],
    [0.052, true],
    [0.053, false],
    [0.054, false],
    [0.033, false],
    [0.034, true],
  ])("a later observation at sectDist %d → %s", (sectDist, expected) => {
    // Act & Assert
    expect(isStationary(observation, { sectOrd: 1, sectDist, observedAt: LATER })).toBe(expected);
  });

  it("is false when the bus is in another section, however near", () => {
    // Act & Assert
    expect(isStationary(observation, { sectOrd: 2, sectDist: 0.043, observedAt: LATER })).toBe(false);
  });

  it.each([true, false])("keeps the previous answer (%s) when TOPIS repeats the same observation", (previous) => {
    // Act & Assert
    expect(isStationary({ ...observation, isStationary: previous }, { sectOrd: 1, sectDist: 0.09, observedAt: observation.observedAt })).toBe(previous);
  });

  it("keeps the previous answer when the observation time goes back", () => {
    // Act & Assert
    expect(isStationary({ ...observation, isStationary: true }, { sectOrd: 1, sectDist: 0.09, observedAt: "2026-10-17T19:11:00+09:00" })).toBe(true);
  });
});

// WHY: TOPIS stops advancing dataTm for a bus idling at its origin (bus 2009, 2026-10-18), and lastStTm, the
// seconds to the terminal, is 0 only at sectOrd 1 (148 of 148 captured rows there, 0 of 969 elsewhere).
describe("isIdlingAtOrigin", () => {
  const previous = { sectOrd: 1, sectDist: 0.044, observedAt: "2026-10-18T11:55:13+09:00", isStationary: false };
  const atOrigin = { sectOrd: 1, sectDist: 0.044, isAtStop: false, lastStTm: 0 };

  it.each([
    ["at the origin with lastStTm 0 and stopFlag 0", true, atOrigin],
    ["at a stop", false, { ...atOrigin, isAtStop: true }],
    ["with lastStTm 1863", false, { ...atOrigin, lastStTm: 1863 }],
    ["with no lastStTm", false, { ...atOrigin, lastStTm: undefined }],
    ["in section 2 with lastStTm 0", false, { ...atOrigin, sectOrd: 2 }],
  ])("a first observation %s → %s, as after a poller restart", (_title, expected, current) => {
    // Act & Assert
    expect(isIdlingAtOrigin(undefined, current)).toBe(expected);
  });

  it.each([
    [0.044, true],
    [0.053, true],
    [0.054, false],
    [0.056, false],
    [0.035, true],
    [0.034, false],
  ])("after an observation at sectDist 0.044, at sectDist %d → %s", (sectDist, expected) => {
    // Act & Assert
    expect(isIdlingAtOrigin(previous, { ...atOrigin, sectDist })).toBe(expected);
  });

  it("holds at a stop once the vehicle was observed before", () => {
    // Act & Assert
    expect(isIdlingAtOrigin(previous, { ...atOrigin, isAtStop: true })).toBe(true);
  });

  it("is false when the previous observation was in another section", () => {
    // Act & Assert
    expect(isIdlingAtOrigin({ ...previous, sectOrd: 27 }, atOrigin)).toBe(false);
  });

  it.each([
    ["lastStTm 1863", { ...atOrigin, lastStTm: 1863 }],
    ["no lastStTm", { ...atOrigin, lastStTm: undefined }],
    ["section 2", { ...atOrigin, sectOrd: 2 }],
  ])("is false with %s, however still", (_title, current) => {
    // Act & Assert
    expect(isIdlingAtOrigin({ ...previous, sectOrd: current.sectOrd }, current)).toBe(false);
  });
});
