/**
 * Run enumeration for arrival estimates (design D10): runs come from the
 * resolved timetable, one per (route type, time), and only entries whose
 * stopTimes fit the sequence.
 */
import { runsOfDay, runsOn, upcomingRuns } from "../../../src/bus/eta/eta-runs";
import type { DayResolution, ScheduleService } from "../../../src/bus/schedule/schedule.service";

function day(date: string, schedule: unknown[], display = "schedule"): DayResolution {
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
    const friday = day("2026-10-16", [
      entry("08:00", "regular"),
      entry("08:00", "hakbu"),
      // A replace override may list the second 08:00 bus as its own entry.
      entry("08:00", "hakbu"),
      entry("08:20", "hakbu"),
    ]);
    expect(runsOfDay("campus-inja", friday, "hakbu", 3).map((r) => r.time)).toEqual(["08:00", "08:20"]);
    expect(runsOfDay("campus-inja", friday, "regular", 3)).toEqual([
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
    const d = day("2026-10-13", [entry("07:00", "regular", null), entry("10:00", "regular", ["10:00", null]), entry("12:00", "regular")]);
    expect(runsOfDay("campus-inja", d, "regular", 3).map((r) => r.time)).toEqual(["12:00"]);
  });

  it("Public holiday and noService override: a day that does not run has no runs", () => {
    expect(runsOfDay("campus-inja", day("2026-10-09", [], "noService"), "regular", 3)).toEqual([]);
    // A noService day is resolved with an empty schedule; even a stray entry is ignored.
    expect(runsOfDay("campus-inja", day("2026-10-14", [entry("10:00", "regular")], "noService"), "regular", 3)).toEqual([]);
    expect(runsOfDay("campus-inja", day("2026-10-17", [], "hidden"), "regular", 3)).toEqual([]);
  });
});

describe("runs through ScheduleService", () => {
  const week = {
    serviceId: "campus-inja",
    requestedFrom: null,
    from: "2026-10-12",
    days: [day("2026-10-12", [entry("07:00", "regular"), entry("10:00", "regular")]), day("2026-10-13", [entry("07:00", "regular")])],
  };
  const schedule = {
    resolveWeek: jest.fn(async () => week),
    resolveSmartSchedule: jest.fn(async () => ({ ...week, status: "active", selectedDate: "2026-10-12" })),
  } as unknown as ScheduleService;

  it("runsOn reads one date of the resolved week", async () => {
    const runs = await runsOn(schedule, "campus-inja", "regular", 3, "2026-10-13");
    expect(runs.map((r) => `${r.date} ${r.time}`)).toEqual(["2026-10-13 07:00"]);
    expect(schedule.resolveWeek).toHaveBeenCalledWith("campus-inja", "2026-10-13");
  });

  it("upcomingRuns keeps the smart view's runs that have not left yet", async () => {
    const now = new Date("2026-10-12T00:30:00.000Z"); // 09:30 KST
    const runs = await upcomingRuns(schedule, "campus-inja", "regular", 3, now);
    expect(runs.map((r) => `${r.date} ${r.time}`)).toEqual(["2026-10-12 10:00", "2026-10-13 07:00"]);
  });

  it("upcomingRuns is empty for a suspended service", async () => {
    const suspended = { resolveSmartSchedule: jest.fn(async () => ({ status: "suspended", days: [] })) } as unknown as ScheduleService;
    expect(await upcomingRuns(suspended, "campus-inja", "regular", 3, new Date())).toEqual([]);
  });
});
