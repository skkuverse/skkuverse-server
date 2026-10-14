/**
 * applyEstimates fills an entry's estimated stops from a served estimate and
 * names its source, and leaves an entry as stored when its route type is not
 * opted in, its stopTimes do not fit the sequence, or no estimate fits.
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
