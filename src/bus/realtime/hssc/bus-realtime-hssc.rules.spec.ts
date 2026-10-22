/**
 * The HSSC rules: the circular → linear stop sequence, the dwell timer that
 * keeps a bus's first sighting at a stop, and the stale windows (3 minutes at
 * the turnaround, 10 elsewhere) at each threshold, and a feed event's key and
 * its strictly parsed stop index and time, and a feed none of whose rows
 * parse.
 */
import "moment/locale/ko";
import moment from "moment-timezone";
import type { HsscBusDoc } from "../../cache/bus-cache.document";
import { isFresh, isUnparsedFeed, toDwellSeconds, toFeedEventKey, toFeedEventTiming, toFirstSeenAt, toHsscStopEvent, toLinearSequence } from "./bus-realtime-hssc.rules";
import { hsscBusDoc } from "../../../../__tests__/helpers/bus/bus-cache-docs";

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

describe("toFeedEventKey", () => {
  it("is the same for a row the feed repeats on the next tick", () => {
    // Act & Assert
    expect(toFeedEventKey({ ...ROW })).toBe(toFeedEventKey(ROW));
  });

  it.each([
    ["line_no", { line_no: "2" }],
    ["seq", { seq: "7" }],
    ["get_date", { get_date: "2026-10-20 오전 9:59:31" }],
    ["inout", { inout: "ENTERED" }],
  ])("differs when %s differs", (_field, change) => {
    // Act & Assert
    expect(toFeedEventKey({ ...ROW, ...change })).not.toBe(toFeedEventKey(ROW));
  });

  it("ignores the stop's id and name", () => {
    // Act & Assert
    expect(toFeedEventKey({ ...ROW, stop_no: "9", stop_name: "다른정류소" })).toBe(toFeedEventKey(ROW));
  });
});

describe("toFeedEventTiming", () => {
  it("parses seq as an integer and get_date as Korean-locale KST", () => {
    // Act & Assert
    expect(toFeedEventTiming(ROW)).toEqual({ seq: 6, getDate: new Date("2026-10-20T00:59:30.000Z") });
  });

  it("reads 오전 12 as just after midnight, on the KST date rather than the UTC one", () => {
    // Act
    const timing = toFeedEventTiming({ ...ROW, get_date: "2026-10-20 오전 12:00:05" });

    // Assert
    expect(timing?.getDate.toISOString()).toBe("2026-10-19T15:00:05.000Z");
    expect(timing?.getDate.toISOString()).not.toBe("2026-10-20T00:00:05.000Z");
  });

  it("keeps seq 0 and seq 10, the ends of the circular index", () => {
    // Act & Assert
    expect(toFeedEventTiming({ ...ROW, seq: "0" })?.seq).toBe(0);
    expect(toFeedEventTiming({ ...ROW, seq: "10" })?.seq).toBe(10);
  });

  it.each([
    ["a 24-hour time with no marker", "2026-10-20 9:59:30"],
    ["trailing text", "2026-10-20 오전 9:59:30 extra"],
    ["an empty string", ""],
  ])("is null for a get_date with %s", (_shape, get_date) => {
    // Act & Assert
    expect(toFeedEventTiming({ ...ROW, get_date })).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["a decimal", "6.5"],
    ["a word", "six"],
    ["negative", "-1"],
  ])("is null for a seq that is %s", (_shape, seq) => {
    // Act & Assert
    expect(toFeedEventTiming({ ...ROW, seq })).toBeNull();
  });
});

// WHY: the live route anchors each cached bus on its latest event, parsed where the feed's date formats live
// (ADR 0018, D1).
describe("toHsscStopEvent", () => {
  it("reads the line, the stop index, the event and both instants of a cached bus", () => {
    // Act
    const event = toHsscStopEvent(hsscBusDoc({ line_no: "32149", seq: "6", inout: "LEFT", get_date: "2026-10-20 오전 9:59:30", eventDate: "2026-10-20 09:58:10" }));

    // Assert
    expect(event).toEqual({
      vehicleId: "32149",
      seq: 6,
      inout: "LEFT",
      eventAt: new Date("2026-10-20T00:59:30.000Z"),
      firstSeenAt: new Date("2026-10-20T00:58:10.000Z"),
    });
  });

  it.each([
    ["a seq that is no index", { seq: "six" }],
    ["a get_date in another shape", { get_date: "2026-10-20 9:59:30" }],
    ["a first sighting in another shape", { eventDate: "2026-10-20T09:58:10" }],
  ])("is null for %s", (_shape, extra) => {
    // Act & Assert
    expect(toHsscStopEvent(hsscBusDoc(extra))).toBeNull();
  });
});

describe("isUnparsedFeed", () => {
  const UNPARSED = { ...ROW, get_date: "2026-10-20 9:59:30" };

  it.each([
    ["is true when every row fails to parse", [UNPARSED, { ...UNPARSED, line_no: "2" }], true],
    ["is false when one row of several parses", [UNPARSED, ROW], false],
    ["is false when every row parses", [ROW], false],
    ["is false when the feed lists no row", [], false],
  ])("%s", (_case, rows, expected) => {
    // Act & Assert
    expect(isUnparsedFeed(rows)).toBe(expected);
  });
});
