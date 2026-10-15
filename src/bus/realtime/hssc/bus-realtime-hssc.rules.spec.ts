/**
 * The HSSC rules: the circular → linear stop sequence, the dwell timer that
 * keeps a bus's first sighting at a stop, and the stale windows (3 minutes at
 * the turnaround, 10 elsewhere) at each threshold.
 */
import "moment/locale/ko";
import moment from "moment-timezone";
import type { HsscBusDoc } from "../../cache/bus-cache.document";
import { isFresh, toDwellSeconds, toFirstSeenAt, toLinearSequence } from "./bus-realtime-hssc.rules";

const NOW = new Date("2026-10-20T01:00:00Z");
const kst = (minutesAgo: number): string =>
  moment(NOW).tz("Asia/Seoul").subtract(minutesAgo, "minutes").format("YYYY-MM-DD HH:mm:ss");
const ROW = { line_no: "1", inout: "LEFT", stop_no: "3", seq: "6", stop_name: "농구장정류소", get_date: "2026-10-20 오전 9:59:30" };

describe("toLinearSequence", () => {
  it.each([
    [0, 7],
    [4, 11],
    [5, 1],
    [8, 4],
    [10, 6],
  ])("seq %i → %i", (seq, expected) => {
    // Act & Assert
    expect(toLinearSequence(seq)).toBe(expected);
  });
});

describe("toFirstSeenAt", () => {
  it("parses get_date, Korean-locale KST, for a bus not seen before", () => {
    // Act & Assert
    expect(toFirstSeenAt(ROW, []).toISOString()).toBe("2026-10-20T00:59:30.000Z");
  });

  it("keeps the previous sighting's time for the same line and stop", () => {
    // Arrange
    const previous = [{ ...ROW, eventDate: "2026-10-20 09:55:00" } as HsscBusDoc];

    // Act & Assert
    expect(toFirstSeenAt(ROW, previous).toISOString()).toBe("2026-10-20T00:55:00.000Z");
  });

  it("starts over at another stop", () => {
    // Arrange
    const previous = [{ ...ROW, stop_no: "4", eventDate: "2026-10-20 09:55:00" } as HsscBusDoc];

    // Act & Assert
    expect(toFirstSeenAt(ROW, previous).toISOString()).toBe("2026-10-20T00:59:30.000Z");
  });
});

describe("toDwellSeconds", () => {
  it("counts whole seconds since the sighting", () => {
    // Act & Assert
    expect(toDwellSeconds(moment(NOW).subtract(90, "seconds"), NOW)).toBe(90);
  });
});

describe("isFresh", () => {
  it.each([
    ["농구장 (셔틀버스정류소)", 2, true],
    ["농구장 (셔틀버스정류소)", 3, true],
    ["농구장 (셔틀버스정류소)", 4, false],
    ["혜화동로터리 [미정차]", 9, true],
    ["혜화동로터리 [미정차]", 10, true],
    ["혜화동로터리 [미정차]", 11, false],
  ])("%s seen %i minutes ago → %s", (stationName, minutesAgo, expected) => {
    // Act & Assert
    expect(isFresh({ stationName, eventDate: kst(minutesAgo) }, NOW)).toBe(expected);
  });
});
