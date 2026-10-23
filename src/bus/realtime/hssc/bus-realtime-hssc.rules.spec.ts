/**
 * The HSSC rules: the circular → linear stop sequence, the dwell timer that
 * keeps a bus's first sighting at a stop, and the stale windows (3 minutes at
 * the turnaround, 10 elsewhere) at each threshold, and a feed event's key and
 * its strictly parsed stop index and time, and a feed none of whose rows
 * parse. A row that would put a fresh bus 1 to 5 positions back in its lap,
 * such as the feed's seq 10 for a bus that already passed seq 1, the same
 * Hyehwa Rotary, is held off by the bus's previous anchor row while that row is
 * fresh (ADR 0018, D8); the live route anchors on the held row.
 */
import "moment/locale/ko";
import moment from "moment-timezone";
import type { HsscBusDoc } from "../../cache/bus-cache.document";
import { isFresh, isLiveFresh, isUnparsedFeed, toDwellSeconds, toFeedEventKey, toFeedEventTiming, toFirstSeenAt, toHeldAnchorRow, toHsscStopEvent, toLinearSequence } from "./bus-realtime-hssc.rules";
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

// WHY: the live route waits out a layover for 15 minutes, the deprecated realtime route 3 (ADR 0019, D8).
describe("isLiveFresh", () => {
  it.each([
    ["농구장 (셔틀버스정류소)", 14, true],
    ["농구장 (셔틀버스정류소)", 15, true],
    ["농구장 (셔틀버스정류소)", 16, false],
    ["혜화동로터리 [미정차]", 9, true],
    ["혜화동로터리 [미정차]", 10, true],
    ["혜화동로터리 [미정차]", 11, false],
  ])("%s seen %i minutes ago → %s", (stationName, minutesAgo, expected) => {
    // Act & Assert
    expect(isLiveFresh({ stationName, eventDate: kst(minutesAgo) }, NOW)).toBe(expected);
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

describe("toHsscStopEvent with a held anchor row", () => {
  it("reads the held row's stop, event and instants, never the feed's own row", () => {
    // Arrange
    const anchorRow = { seq: "1", inout: "LEFT", get_date: "2026-10-20 오전 9:58:40", stationName: "혜화동로터리 [미정차]", eventDate: "2026-10-20 09:58:30" };
    const bus = hsscBusDoc({ line_no: "32149", seq: "10", inout: "LEFT_LAST", get_date: "2026-10-20 오전 9:59:30", eventDate: "2026-10-20 09:59:30", anchorRow });

    // Act & Assert
    expect(toHsscStopEvent(bus)).toEqual({
      vehicleId: "32149",
      seq: 1,
      inout: "LEFT",
      eventAt: new Date("2026-10-20T00:58:40.000Z"),
      firstSeenAt: new Date("2026-10-20T00:58:30.000Z"),
    });
  });
});

// WHY: past seq 1 the feed reports seq 10, the same rotary, on about 27% of passes (ADR 0018, D8).
describe("toHeldAnchorRow", () => {
  const ROTARY = "혜화동로터리 [미정차]";
  const TURNAROUND = "농구장 (셔틀버스정류소)";
  const previousRow = (seq: string, stationName: string, minutesAgo = 1) =>
    hsscBusDoc({ line_no: "32149", seq, inout: "LEFT", get_date: "2026-10-20 오전 9:58:00", stationName, eventDate: kst(minutesAgo) });
  const feedRow = (seq: string, stationName: string) => hsscBusDoc({ line_no: "32149", seq, inout: "ENTERED", stationName, eventDate: kst(0) });

  it.each([
    ["seq 1 → seq 10, the rotary confusion, 2 back", previousRow("1", ROTARY), feedRow("10", ROTARY), "1"],
    ["seq 0 → seq 9, 1 back", previousRow("0", "혜화역 1번출구 (셔틀버스정류소)"), feedRow("9", "혜화동우체국 [하차전용]"), "0"],
    ["seq 4 → seq 10, 5 back", previousRow("4", "600주년기념관"), feedRow("10", ROTARY), "4"],
    ["seq 5 laying over → seq 4, 1 back", previousRow("5", TURNAROUND, 14), feedRow("4", "600주년기념관"), "5"],
  ])("holds the previous row for %s within its freshness", (_case, previous, row, heldSeq) => {
    // Act & Assert
    expect(toHeldAnchorRow(row, [previous], NOW)).toEqual({ seq: heldSeq, inout: "LEFT", get_date: "2026-10-20 오전 9:58:00", stationName: previous.stationName, eventDate: previous.eventDate });
  });

  it.each([
    ["seq 10 → seq 0, forward", previousRow("10", ROTARY), feedRow("0", "혜화역 1번출구 (셔틀버스정류소)")],
    ["seq 4 → seq 5, the lap's wrap at the turnaround", previousRow("4", "600주년기념관"), feedRow("5", TURNAROUND)],
    ["seq 6 → seq 5, back to the turnaround, which is never held off", previousRow("6", "600주년기념관"), feedRow("5", TURNAROUND)],
    ["seq 5 → seq 10, 6 back, that is 5 forward", previousRow("5", TURNAROUND), feedRow("10", ROTARY)],
    ["seq 1 → seq 1, the same stop", previousRow("1", ROTARY), feedRow("1", ROTARY)],
    ["seq 1 → seq 10 with the previous row seen 11 minutes ago, stale", previousRow("1", ROTARY, 11), feedRow("10", ROTARY)],
    ["seq 5 → seq 4 with the layover seen 16 minutes ago, stale", previousRow("5", TURNAROUND, 16), feedRow("4", "600주년기념관")],
  ])("anchors on the feed's row for %s", (_case, previous, row) => {
    // Act & Assert
    expect(toHeldAnchorRow(row, [previous], NOW)).toBeNull();
  });

  it("holds at the edge of the previous row's freshness, 10 minutes", () => {
    // Act & Assert
    expect(toHeldAnchorRow(feedRow("10", ROTARY), [previousRow("1", ROTARY, 10)], NOW)).toMatchObject({ seq: "1" });
  });

  it("anchors on the feed's row for a bus with no previous row, or another line's", () => {
    // Arrange
    const otherLine = { ...previousRow("1", ROTARY), line_no: "32150" };

    // Act & Assert
    expect(toHeldAnchorRow(feedRow("10", ROTARY), [], NOW)).toBeNull();
    expect(toHeldAnchorRow(feedRow("10", ROTARY), [otherLine], NOW)).toBeNull();
  });

  it("keeps holding the row it held on the previous tick, still fresh, while the feed stays backward", () => {
    // Arrange
    const held = { seq: "1", inout: "LEFT", get_date: "2026-10-20 오전 9:58:00", stationName: ROTARY, eventDate: kst(2) };
    const previous = hsscBusDoc({ line_no: "32149", seq: "10", inout: "ENTERED", stationName: ROTARY, eventDate: kst(1), anchorRow: held });

    // Act & Assert
    expect(toHeldAnchorRow(feedRow("10", ROTARY), [previous], NOW)).toEqual(held);
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
