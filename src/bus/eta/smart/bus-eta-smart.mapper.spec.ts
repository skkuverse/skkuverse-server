/**
 * applyEstimates fills an entry's estimated stops from a served estimate and
 * names its source, and leaves an entry as stored when its route type is not
 * opted in, its stopTimes do not fit the sequence, or no estimate fits. A
 * scheduled stop after the first holds the bus until its stored time.
 */
import type { SmartSchedule } from "../../schedule/bus-schedule.wire";
import type { SequenceStop } from "../../stops/bus-stops.types";
import { applyEstimates } from "./bus-eta-smart.mapper";
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
