/**
 * The estimate rules (design D10): runs come from a resolved day, one per
 * (route type, time), and only entries whose stopTimes fit the sequence; the
 * opted-in sequences carry their stops' coordinates in order; and the daily
 * cap starts over at 00:00 KST.
 */
import { DailyCapError } from "../../shared/daily-cap.error";
import type { ScheduleDay, ScheduleEntry } from "../schedule/bus-schedule.wire";
import { BusStopsService } from "../stops/bus-stops.service";
import { DailyCap, runsOfDay, toEtaSequences, toSequenceLength } from "./bus-eta.rules";

function day(date: string, schedule: ScheduleEntry[], display = "schedule"): ScheduleDay {
  return { date, dayOfWeek: 5, display, label: null, notices: [], schedule };
}
/** `stopTimes: null` builds an entry without the key. */
const entry = (time: string, routeType: string, stopTimes: Array<string | null> | null = [time, null, null]) => ({
  time,
  routeType,
  busCount: 1,
  notes: null,
  ...(stopTimes ? { stopTimes } : {}),
});

describe("runsOfDay", () => {
  it("Friday 08:00: the regular and the 학부대학 departures are separate runs, each once", () => {
    // Act
    const friday = day("2026-10-16", [
      entry("08:00", "regular"),
      entry("08:00", "hakbu"),
      // A replace override may list the second 08:00 bus as its own entry.
      entry("08:00", "hakbu"),
      entry("08:20", "hakbu"),
    ]);

    // Assert
    expect(runsOfDay(friday, { serviceId: "campus-inja", routeType: "hakbu", sequenceLength: 3 }).map((r) => r.time)).toEqual(["08:00", "08:20"]);
    expect(runsOfDay(friday, { serviceId: "campus-inja", routeType: "regular", sequenceLength: 3 })).toEqual([
      {
        serviceId: "campus-inja",
        routeType: "regular",
        date: "2026-10-16",
        time: "08:00",
        departAt: new Date("2026-10-15T23:00:00.000Z"),
      },
    ]);
  });

  it("skips entries without stopTimes, or with stopTimes for another sequence length", () => {
    // Act
    const d = day("2026-10-13", [entry("07:00", "regular", null), entry("10:00", "regular", ["10:00", null]), entry("12:00", "regular")]);

    // Assert
    expect(runsOfDay(d, { serviceId: "campus-inja", routeType: "regular", sequenceLength: 3 }).map((r) => r.time)).toEqual(["12:00"]);
  });

  it("Public holiday and noService override: a day that does not run has no runs", () => {
    // Act & Assert
    expect(runsOfDay(day("2026-10-09", [], "noService"), { serviceId: "campus-inja", routeType: "regular", sequenceLength: 3 })).toEqual([]);
    // A noService day is resolved with an empty schedule; even a stray entry is ignored.
    expect(runsOfDay(day("2026-10-14", [entry("10:00", "regular")], "noService"), { serviceId: "campus-inja", routeType: "regular", sequenceLength: 3 })).toEqual([]);
    expect(runsOfDay(day("2026-10-17", [], "hidden"), { serviceId: "campus-inja", routeType: "regular", sequenceLength: 3 })).toEqual([]);
  });
});

describe("toEtaSequences", () => {
  it("lists the opted-in route types with their stops' coordinates, in order", () => {
    // Arrange
    const stops = new BusStopsService();

    // Act
    const seqs = toEtaSequences(stops.catalog(), stops.etaOptIns());

    // Assert
    expect(seqs.map((s) => `${s.serviceId}.${s.routeType}:${s.stops.length}`)).toEqual([
      "campus-inja.regular:2",
      "campus-inja.hakbu:2",
      "campus-jain.regular:2",
      "campus-jain.hakbu:2",
    ]);
    expect(seqs[0]!.stops).toEqual([
      { lat: 37.587367, lng: 126.993643 },
      { lat: 37.292298, lng: 126.975057 },
    ]);
    const length = toSequenceLength(seqs);
    expect(length("campus-jain", "hakbu")).toBe(2);
    expect(length("commute-jamsil", "down")).toBeUndefined();
  });
});

describe("DailyCap", () => {
  it("allows the cap's calls in a KST day and starts over at 00:00 KST", () => {
    // Arrange
    const cap = new DailyCap("tmap", 2);
    const evening = new Date("2026-10-12T14:59:00.000Z"); // 23:59 KST
    const midnight = new Date("2026-10-12T15:00:00.000Z"); // 00:00 KST next day

    // Act & Assert
    cap.take(evening);
    cap.take(evening);
    expect(() => cap.take(evening)).toThrow(DailyCapError);
    expect(() => cap.take(midnight)).not.toThrow();
  });
});
