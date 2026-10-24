/**
 * Which stored estimate a run is served with: frozen > live (at most 15 minutes old) > predicted (unexpired).
 * Which one is its latest, for the stop page's listing cutoff only: the newest fetch among its unexpired documents of
 * any kind, a live value too old to serve included (ADR 0019, D12).
 * And how a run's offsets respect a scheduled stop after the first: the bus
 * never leaves it before its timetable time. A timetable time is KST on its
 * date, and a run's stop time before its departure is past midnight, the next
 * day's; a run is under way until the minute after its last instant passes.
 */
import type { ShuttleEtaDoc } from "../bus-eta.document";
import { floorAtScheduledStops, isUnderWayAt, pickEstimates, pickLatestEstimates, runKey, toStopAt, toTimetableAt } from "./bus-eta-smart.rules";

const NOW = new Date("2026-10-12T00:40:00.000Z"); // 09:40 KST, 20 minutes before the 10:00 run
const KEY = runKey({ serviceId: "campus-inja", routeType: "regular", date: "2026-10-12", time: "10:00" });
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function doc(kind: "baseline" | "live", fields: Partial<ShuttleEtaDoc> = {}): ShuttleEtaDoc {
  return {
    _id: `campus-inja|regular|2026-10-12|10:00|${kind}`,
    kind,
    serviceId: "campus-inja",
    routeType: "regular",
    date: "2026-10-12",
    time: "10:00",
    departAt: new Date("2026-10-12T01:00:00.000Z"),
    offsetsSec: kind === "baseline" ? [0, 2800, 2950] : [0, 3060, 3180],
    source: kind === "baseline" ? "tmap" : "naver",
    fetchedAt: minutesAgo(5),
    expiresAt: new Date(NOW.getTime() + 60 * 60_000),
    ...fields,
  };
}

describe("pickEstimates", () => {
  it("Live and predicted both exist: the live value wins", () => {
    // Act
    const best = pickEstimates([doc("baseline"), doc("live")], NOW).get(KEY)!;

    // Assert
    expect(best).toEqual({ offsetsSec: [0, 3060, 3180], source: "live", updatedAt: minutesAgo(5) });
  });

  it("a frozen value wins over everything, however old", () => {
    // Act
    const frozen = doc("live", { frozen: true, frozenAt: minutesAgo(90), fetchedAt: minutesAgo(90) });

    // Assert
    expect(pickEstimates([doc("baseline"), frozen], NOW).get(KEY)!.source).toBe("frozen");
  });

  it("serves a live value only while it is at most 15 minutes old, then falls back to the prediction", () => {
    // Act & Assert
    expect(pickEstimates([doc("live", { fetchedAt: minutesAgo(15) })], NOW).get(KEY)!.source).toBe("live");
    expect(pickEstimates([doc("live", { fetchedAt: minutesAgo(16) })], NOW).has(KEY)).toBe(false);
    expect(pickEstimates([doc("baseline"), doc("live", { fetchedAt: minutesAgo(16) })], NOW).get(KEY)!.source).toBe("predicted");
  });

  it("Prediction past its life: an expired prediction is not served", () => {
    // Act
    const expired = doc("baseline", { expiresAt: minutesAgo(1) });

    // Assert
    expect(pickEstimates([expired], NOW).size).toBe(0);
  });

  it("keeps runs apart by service, route type, date and time", () => {
    // Arrange
    const other = doc("baseline", { time: "12:00" });

    // Act
    const map = pickEstimates([doc("baseline"), other], NOW);

    // Assert
    expect([...map.keys()].sort()).toEqual([KEY, runKey({ serviceId: "campus-inja", routeType: "regular", date: "2026-10-12", time: "12:00" })]);
  });
});

describe("pickLatestEstimates", () => {
  it("takes a live value fetched 20 minutes ago, too old to serve, over the morning's prediction", () => {
    // Arrange
    const docs = [doc("baseline", { fetchedAt: minutesAgo(300) }), doc("live", { fetchedAt: minutesAgo(20) })];

    // Act
    const latest = pickLatestEstimates(docs, NOW).get(KEY);

    // Assert
    expect(latest).toEqual({ offsetsSec: [0, 3060, 3180], source: "live", updatedAt: minutesAgo(20) });
    expect(pickEstimates(docs, NOW).get(KEY)!.source).toBe("predicted");
  });

  it("takes a prediction fetched after the live value", () => {
    // Act
    const latest = pickLatestEstimates([doc("live", { fetchedAt: minutesAgo(30) }), doc("baseline", { fetchedAt: minutesAgo(10) })], NOW).get(KEY);

    // Assert
    expect(latest).toEqual({ offsetsSec: [0, 2800, 2950], source: "predicted", updatedAt: minutesAgo(10) });
  });

  it("marks a fixed value frozen", () => {
    // Act
    const latest = pickLatestEstimates([doc("live", { frozen: true, frozenAt: minutesAgo(90), fetchedAt: minutesAgo(90) })], NOW).get(KEY);

    // Assert
    expect(latest?.source).toBe("frozen");
  });

  it.each([
    ["one millisecond before now", -1, false],
    ["now", 0, false],
    ["one millisecond after now", 1, true],
  ])("a document that expires %s counts: %s", (_case, expiresInMs, counts) => {
    // Arrange
    const expiresAt = new Date(NOW.getTime() + expiresInMs);

    // Act
    const latest = pickLatestEstimates([doc("live", { fetchedAt: minutesAgo(40), expiresAt }), doc("baseline", { fetchedAt: minutesAgo(300) })], NOW).get(KEY);

    // Assert
    expect(latest?.source).toBe(counts ? "live" : "predicted");
  });

  it("answers no run with no unexpired document", () => {
    // Act & Assert
    expect(pickLatestEstimates([doc("baseline", { expiresAt: minutesAgo(1) })], NOW).size).toBe(0);
  });
});

describe("floorAtScheduledStops", () => {
  // Gangnam 07:40, then Yangjae 07:45 (scheduled, 300 s after departure), then campus (estimated).
  const GANGNAM_YANGJAE = [0, 300, null];

  it.each([
    ["one second before the timetable: waits there, and every later stop moves with it", [0, 299, 3000], [0, 300, 3001]],
    ["well before the timetable: waits the whole difference", [0, 120, 3000], [0, 300, 3180]],
    ["exactly at the timetable: unchanged", [0, 300, 3000], [0, 300, 3000]],
    ["one second after the timetable (traffic): keeps the real delay", [0, 301, 3000], [0, 301, 3000]],
  ])("reaching the scheduled stop %s", (_case, offsetsSec, expected) => {
    // Act & Assert
    expect(floorAtScheduledStops(offsetsSec, GANGNAM_YANGJAE)).toEqual(expected);
  });

  it.each([
    ["a two-stop run", [0, 3000], [0, null]],
    ["estimated stops only after the first", [0, 1200, 3000], [0, null, null]],
  ])("leaves %s as routed", (_case, offsetsSec, scheduledOffsetsSec) => {
    // Act & Assert
    expect(floorAtScheduledStops(offsetsSec, scheduledOffsetsSec)).toEqual(offsetsSec);
  });

  it("adds up the waits of two scheduled stops in a row", () => {
    // Act
    const floored = floorAtScheduledStops([0, 100, 200, 1000], [0, 300, 700, null]);

    // Assert
    expect(floored).toEqual([0, 300, 700, 1500]);
  });

  it("returns a new array and leaves the stored offsets alone", () => {
    // Arrange
    const offsetsSec = [0, 120, 3000];

    // Act
    const floored = floorAtScheduledStops(offsetsSec, GANGNAM_YANGJAE);

    // Assert
    expect(floored).not.toBe(offsetsSec);
    expect(offsetsSec).toEqual([0, 120, 3000]);
  });
});

// WHY: the timetable stores each stop of a run as "HH:mm" on its departure's date; the run read parses it once.
describe("toStopAt", () => {
  const DEPARTURE_AT = new Date("2026-10-22T14:30:00.000Z"); // 23:30 KST on Thursday the 22nd

  it.each([
    ["one minute before the departure, the next day's", "23:29", "2026-10-23T14:29:00.000Z"],
    ["past midnight, the next day's", "00:50", "2026-10-22T15:50:00.000Z"],
    ["at the departure, the same day's", "23:30", "2026-10-22T14:30:00.000Z"],
    ["one minute after the departure, the same day's", "23:31", "2026-10-22T14:31:00.000Z"],
  ])("reads a time %s", (_case, time, expected) => {
    // Act & Assert
    expect(toStopAt(DEPARTURE_AT, "2026-10-22", time).toISOString()).toBe(expected);
  });

  it("reads the date as KST's, not UTC's, which is the day before until 09:00", () => {
    // Act
    const at = toStopAt(new Date("2026-10-22T23:30:00.000Z"), "2026-10-23", "08:45");

    // Assert
    expect(at.toISOString()).toBe("2026-10-22T23:45:00.000Z");
    expect(at.toISOString()).not.toBe("2026-10-23T23:45:00.000Z");
  });
});

describe("toTimetableAt", () => {
  it("reads a timetable time as KST wall-clock time on its date, not the server zone's", () => {
    // Act
    const at = toTimetableAt("2026-10-23", "08:45");

    // Assert
    expect(at.toISOString()).toBe("2026-10-22T23:45:00.000Z");
    expect(at.toISOString()).not.toBe("2026-10-23T08:45:00.000Z");
  });
});

describe("isUnderWayAt", () => {
  const run = { departureAt: new Date("2026-10-22T14:30:00.000Z"), stopTimes: [{ shownAt: null, isEstimated: false, latestEstimateAt: new Date("2026-10-22T15:52:00.000Z") }] };

  it.each([
    ["in its last instant's minute", "2026-10-22T15:52:59.000Z", true],
    ["a minute before its last instant", "2026-10-22T15:51:00.000Z", true],
    ["the minute after its last instant", "2026-10-22T15:53:00.000Z", false],
  ])("counts a run %s as under way: %s", (_case, from, expected) => {
    // Act & Assert
    expect(isUnderWayAt(run, new Date(from))).toBe(expected);
  });
});
