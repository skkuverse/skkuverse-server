/**
 * BusEtaService over an in-memory store and a stub schedule: the runs it reads
 * from the resolved timetable (one date of a week, or the smart view's runs not
 * yet departed, none for a suspended service), and the stored documents it
 * drops when their stop count no longer fits their sequence.
 */
import { FakeBusEtaRepository } from "../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { BusScheduleService } from "../schedule/bus-schedule.service";
import type { ScheduleDay, ScheduleEntry } from "../schedule/bus-schedule.wire";
import { BusStopsService } from "../stops/bus-stops.service";
import type { ShuttleEtaDoc } from "./bus-eta.document";
import type { BusEtaRepository } from "./bus-eta.repository";
import { BusEtaService } from "./bus-eta.service";
import type { EtaSequence } from "./bus-eta.types";

function day(date: string, schedule: ScheduleEntry[], display = "schedule"): ScheduleDay {
  return { date, dayOfWeek: 5, display, label: null, notices: [], schedule };
}
const entry = (time: string, routeType: string): ScheduleEntry => ({ time, routeType, busCount: 1, notes: null, stopTimes: [time, null, null] });
const SEQUENCE: EtaSequence = { serviceId: "campus-inja", routeType: "regular", stops: [{ lat: 37.5, lng: 127 }, { lat: 37.4, lng: 127 }, { lat: 37.3, lng: 127 }] };

const build = (schedule: Partial<BusScheduleService>, repository = new FakeBusEtaRepository()) =>
  new BusEtaService(asReal<BusEtaRepository>(repository), schedule as BusScheduleService, new BusStopsService());

describe("BusEtaService runs", () => {
  const week = {
    serviceId: "campus-inja",
    requestedFrom: null,
    from: "2026-10-12",
    days: [day("2026-10-12", [entry("07:00", "regular"), entry("10:00", "regular")]), day("2026-10-13", [entry("07:00", "regular")])],
  };
  const schedule = {
    resolveWeek: jest.fn(async () => week),
    resolveSmartSchedule: jest.fn(async () => ({ ...week, status: "active" as const, selectedDate: "2026-10-12" })),
  };

  it("runsOn reads one date of the resolved week", async () => {
    // Act
    const runs = await build(schedule).runsOn(SEQUENCE, "2026-10-13");

    // Assert
    expect(runs.map((r) => `${r.date} ${r.time}`)).toEqual(["2026-10-13 07:00"]);
    expect(schedule.resolveWeek).toHaveBeenCalledWith("campus-inja", "2026-10-13");
  });

  it("upcomingRuns keeps the smart view's runs that have not left yet", async () => {
    // Arrange
    const now = new Date("2026-10-12T00:30:00.000Z"); // 09:30 KST

    // Act
    const runs = await build(schedule).upcomingRuns(SEQUENCE, now);

    // Assert
    expect(runs.map((r) => `${r.date} ${r.time}`)).toEqual(["2026-10-12 10:00", "2026-10-13 07:00"]);
  });

  it("upcomingRuns is empty for a suspended service", async () => {
    // Act
    const suspended = { resolveSmartSchedule: jest.fn(async () => ({ serviceId: "campus-inja", status: "suspended" as const, from: null, selectedDate: null, days: [] })) };

    // Assert
    expect(await build(suspended).upcomingRuns(SEQUENCE, new Date("2026-10-12T00:30:00.000Z"))).toEqual([]);
  });
});

describe("BusEtaService.listFitting", () => {
  it("drops stored documents whose stop count no longer fits their sequence", async () => {
    // Arrange
    const doc = (routeType: string, offsetsSec: number[]) =>
      ({ _id: `${routeType}-${offsetsSec.length}`, serviceId: "campus-inja", routeType, date: "2026-10-12", offsetsSec }) as ShuttleEtaDoc;
    const stale = doc("regular", [0, 4500, 4620]); // fetched while the sequence had three stops
    const fresh = doc("regular", [0, 4500]);
    const hakbu = doc("hakbu", [0, 4400]);
    const repository = new FakeBusEtaRepository();
    for (const d of [stale, fresh, hakbu]) repository.docs.set(d._id + d.offsetsSec.join(), d);

    // Act
    const read = jest.spyOn(repository, "listEstimates");

    // Assert
    await expect(build({}, repository).listFitting(["campus-inja"], ["2026-10-12"])).resolves.toEqual([fresh, hakbu]);
    expect(read).toHaveBeenCalledWith(["campus-inja"], ["2026-10-12"]);
  });
});
