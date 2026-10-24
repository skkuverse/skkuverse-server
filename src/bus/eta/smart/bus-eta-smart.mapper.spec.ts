/**
 * applyEstimates fills an entry's estimated stops from a served estimate and
 * names its source, and leaves an entry as stored when its route type is not
 * opted in, its stopTimes do not fit the sequence, or no estimate fits. A
 * scheduled stop after the first holds the bus until its stored time.
 * toDayRuns reads each entry of a day as a run once: its departure and stop
 * times as instants, the served estimate and the latest one at its estimated
 * stops, and whether it is the day's last run of its route type.
 */
import type { SmartSchedule } from "../../schedule/bus-schedule.wire";
import type { SequenceStop } from "../../stops/bus-stops.types";
import { applyEstimates, toDayRuns } from "./bus-eta-smart.mapper";
import { runKey } from "./bus-eta-smart.rules";
import type { ServedEstimate } from "./bus-eta-smart.types";

const SEQUENCES: Record<string, SequenceStop[]> = {
  regular: [
    { stopId: "a", action: "board", timing: "scheduled" },
    { stopId: "b", action: "alight", timing: "estimated" },
  ],
};
const smart = (stopTimes: Array<string | null>, routeType = "regular"): SmartSchedule => ({
  serviceId: "campus-inja",
  status: "active",
  from: "2026-10-12",
  selectedDate: "2026-10-12",
  days: [{ date: "2026-10-12", dayOfWeek: 1, display: "schedule", label: null, notices: [], schedule: [{ time: "10:00", routeType, stopTimes }] }],
});
const estimate = (offsetsSec: number[]): Map<string, ServedEstimate> =>
  new Map([[runKey({ serviceId: "campus-inja", routeType: "regular", date: "2026-10-12", time: "10:00" }), { offsetsSec, source: "live", updatedAt: new Date("2026-10-12T00:20:00.000Z") }]]);

describe("applyEstimates", () => {
  it("fills the estimated stop, rounded to the minute, and names the source", () => {
    // Act
    const applied = applyEstimates(smart(["10:00", null]), { routeTypes: ["regular"], sequences: SEQUENCES, estimates: estimate([0, 3060]) });

    // Assert
    expect(applied.days[0]!.schedule[0]).toEqual({
      time: "10:00",
      routeType: "regular",
      stopTimes: ["10:00", "10:51"],
      eta: { source: "live", updatedAt: "2026-10-12T00:20:00.000Z" },
    });
  });

  it.each([
    ["a route type not opted in", smart(["10:00", null], "hakbu"), ["regular"], estimate([0, 3060])],
    ["stopTimes for another sequence", smart(["10:00", null, null]), ["regular"], estimate([0, 3060])],
    ["offsets for another sequence", smart(["10:00", null]), ["regular"], estimate([0, 3060, 3180])],
    ["no estimate", smart(["10:00", null]), ["regular"], new Map<string, ServedEstimate>()],
  ])("leaves the entry as stored for %s", (_case, schedule, routeTypes, estimates) => {
    // Act
    const applied = applyEstimates(schedule, { routeTypes, sequences: SEQUENCES, estimates });

    // Assert
    expect(applied.days[0]!.schedule[0]).toBe(schedule.days[0]!.schedule[0]);
  });
});

describe("applyEstimates with a second scheduled boarding stop", () => {
  // The Gangnam-Yangjae morning run: Gangnam 07:40, Yangjae 07:45 on the timetable, then campus.
  const UP: Record<string, SequenceStop[]> = {
    up: [
      { stopId: "gangnam-exit5", action: "board", timing: "scheduled" },
      { stopId: "yangjae-exit2", action: "board", timing: "scheduled" },
      { stopId: "nsc-n-center", action: "alight", timing: "estimated" },
    ],
  };
  const run = (offsetsSec: number[]) => {
    const schedule: SmartSchedule = {
      serviceId: "commute-gangnam-yangjae",
      status: "active",
      from: "2026-10-19",
      selectedDate: "2026-10-19",
      days: [{ date: "2026-10-19", dayOfWeek: 1, display: "schedule", label: null, notices: [], schedule: [{ time: "07:40", routeType: "up", stopTimes: ["07:40", "07:45", null] }] }],
    };
    const estimates = new Map([[runKey({ serviceId: "commute-gangnam-yangjae", routeType: "up", date: "2026-10-19", time: "07:40" }), { offsetsSec, source: "predicted" as const, updatedAt: new Date("2026-10-18T19:00:00.000Z") }]]);
    return applyEstimates(schedule, { routeTypes: ["up"], sequences: UP, estimates }).days[0]!.schedule[0]!.stopTimes;
  };

  it("counts the campus arrival from Yangjae's 07:45 when the road reaches Yangjae earlier", () => {
    // Act
    const stopTimes = run([0, 120, 3000]);

    // Assert
    // 07:45 + (3000 − 120) s = 08:33, not 07:40 + 3000 s = 08:30.
    expect(stopTimes).toEqual(["07:40", "07:45", "08:33"]);
  });

  it("keeps the traffic delay when the road reaches Yangjae after 07:45", () => {
    // Act
    const stopTimes = run([0, 600, 3600]);

    // Assert
    expect(stopTimes).toEqual(["07:40", "07:45", "08:40"]);
  });
});

describe("toDayRuns", () => {
  const JAMSIL_SEQUENCES = {
    down: [
      { stopId: "nsc-opposite", action: "board" as const, timing: "scheduled" as const },
      { stopId: "jamsil-exit5", action: "alight" as const, timing: "estimated" as const },
    ],
  };
  const UPDATED_AT = new Date("2026-10-21T19:00:00.000Z");
  const estimateOf = (time: string, offsetsSec: number[], source: "predicted" | "live" = "predicted") =>
    [runKey({ serviceId: "commute-jamsil", routeType: "down", date: "2026-10-22", time }), { offsetsSec, source, updatedAt: UPDATED_AT }] as const;
  const day = (schedule: Array<Record<string, unknown>>) => ({ date: "2026-10-22", dayOfWeek: 4, display: "schedule", notices: [], schedule });
  const at = (iso: string) => new Date(iso);

  it("parses each run once: its departure, each stop time past midnight on the next day, and the day's last run of its route type", () => {
    // Act
    const runs = toDayRuns("commute-jamsil", day([{ time: "21:00", routeType: "down", stopTimes: ["21:00", "22:20"] }, { time: "23:30", routeType: "down", stopTimes: ["23:30", "00:50"] }]), {
      routeTypes: [],
      sequences: {},
      estimates: new Map(),
    });

    // Assert
    expect(runs).toEqual([
      {
        runId: "commute-jamsil|down|2026-10-22|21:00",
        routeType: "down",
        date: "2026-10-22",
        departureAt: at("2026-10-22T12:00:00.000Z"),
        isLastOfDay: false,
        stopTimes: [
          { shownAt: at("2026-10-22T12:00:00.000Z"), isEstimated: false, latestEstimateAt: null },
          { shownAt: at("2026-10-22T13:20:00.000Z"), isEstimated: false, latestEstimateAt: null },
        ],
        estimate: null,
      },
      {
        runId: "commute-jamsil|down|2026-10-22|23:30",
        routeType: "down",
        date: "2026-10-22",
        departureAt: at("2026-10-22T14:30:00.000Z"),
        isLastOfDay: true,
        stopTimes: [
          { shownAt: at("2026-10-22T14:30:00.000Z"), isEstimated: false, latestEstimateAt: null },
          { shownAt: at("2026-10-22T15:50:00.000Z"), isEstimated: false, latestEstimateAt: null },
        ],
        estimate: null,
      },
    ]);
  });

  it("takes the last run of the day per route type, so a later run of another type leaves a type's last run its last bus", () => {
    // Act
    const runs = toDayRuns(
      "campus-inja",
      { date: "2026-10-23", schedule: [{ time: "13:00", routeType: "regular" }, { time: "14:00", routeType: "regular" }, { time: "14:20", routeType: "hakbu" }] },
      { routeTypes: [], sequences: {}, estimates: new Map() },
    );

    // Assert
    expect(runs.map((run) => run?.isLastOfDay)).toEqual([false, true, true]);
  });

  it("answers null for an entry with no route type or no departure, in the entry's place", () => {
    // Act
    const runs = toDayRuns("commute-jamsil", day([{ routeType: "down", stopTimes: [] }, { time: "21:00", stopTimes: [] }, { time: "21:00", routeType: "down" }]), {
      routeTypes: [],
      sequences: {},
      estimates: new Map(),
    });

    // Assert
    expect(runs.map((run) => run && run.stopTimes)).toEqual([null, null, []]);
  });

  it("serves the estimate at an estimated stop, rounded to the minute and past midnight, keeping the timetable at a scheduled one", () => {
    // Act
    const [run] = toDayRuns("commute-jamsil", day([{ time: "23:30", routeType: "down", stopTimes: ["23:30", "00:50"] }]), {
      routeTypes: ["down"],
      sequences: JAMSIL_SEQUENCES,
      estimates: new Map([estimateOf("23:30", [0, 4890])]),
    });

    // Assert
    expect(run!.estimate).toEqual({ source: "predicted", updatedAt: UPDATED_AT });
    expect(run!.stopTimes).toEqual([
      { shownAt: at("2026-10-22T14:30:00.000Z"), isEstimated: false, latestEstimateAt: null },
      { shownAt: at("2026-10-22T15:52:00.000Z"), isEstimated: true, latestEstimateAt: null },
    ]);
  });

  it("carries the latest estimate at an estimated stop beside the served one, and none at a scheduled stop", () => {
    // Act
    const [run] = toDayRuns("commute-jamsil", day([{ time: "23:30", routeType: "down", stopTimes: ["23:30", "00:50"] }]), {
      routeTypes: ["down"],
      sequences: JAMSIL_SEQUENCES,
      estimates: new Map([estimateOf("23:30", [0, 4890])]),
      latestEstimates: new Map([estimateOf("23:30", [0, 5400], "live")]),
    });

    // Assert
    expect(run!.stopTimes.map(({ latestEstimateAt }) => latestEstimateAt)).toEqual([null, at("2026-10-22T16:00:00.000Z")]);
  });

  it.each([
    ["a route type not opted in", { routeTypes: [], estimates: new Map([estimateOf("23:30", [0, 4890])]) }],
    ["no estimate", { routeTypes: ["down"], estimates: new Map() }],
    ["offsets for another sequence", { routeTypes: ["down"], estimates: new Map([estimateOf("23:30", [0, 600, 4890])]) }],
  ])("serves the timetable with no estimate for %s", (_case, inputs) => {
    // Act
    const [run] = toDayRuns("commute-jamsil", day([{ time: "23:30", routeType: "down", stopTimes: ["23:30", "00:50"] }]), { ...inputs, sequences: JAMSIL_SEQUENCES });

    // Assert
    expect(run!.estimate).toBeNull();
    expect(run!.stopTimes.map(({ shownAt, isEstimated }) => [shownAt, isEstimated])).toEqual([
      [at("2026-10-22T14:30:00.000Z"), false],
      [at("2026-10-22T15:50:00.000Z"), false],
    ]);
  });
});
