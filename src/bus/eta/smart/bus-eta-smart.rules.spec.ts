/**
 * Which stored estimate a run is served with: frozen > live (at most 15 minutes old) > predicted (unexpired).
 * And how a run's offsets respect a scheduled stop after the first: the bus
 * never leaves it before its timetable time.
 */
import type { ShuttleEtaDoc } from "../bus-eta.document";
import { floorAtScheduledStops, pickEstimates, runKey } from "./bus-eta-smart.rules";

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
