/**
 * The live tick's travel-model rules: due runs grouped by travel model, one
 * group per model and direction; a bus-lane value as the forced route's
 * offsets with the corridor's car time replaced by the bus-lane time; the one
 * minute that primes the probe ten minutes before a window opens; and a value
 * fixed from the last live one keeping how it was timed.
 */
import moment from "moment-timezone";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import { etaDocId } from "../bus-eta.mapper";
import type { EtaRun } from "../bus-eta.types";
import type { SequenceStrategy } from "../lane/bus-eta-lane.types";
import { liveDoc } from "./bus-eta-live.mapper";
import { isPrimeMinute, toBusLaneOffsets, toLiveWork, toModelGroups } from "./bus-eta-live.rules";

const DATE = "2026-10-16"; // a Friday
const at = (hhmm: string, seconds = 0) => moment.tz(`${DATE} ${hhmm}`, "YYYY-MM-DD HH:mm", "Asia/Seoul").add(seconds, "s").toDate();
const run = (time: string): EtaRun => ({ serviceId: "campus-inja", routeType: "regular", date: DATE, time, departAt: at(time) });
const SOUTHBOUND: SequenceStrategy = { strategy: "busLane", direction: "southbound" };
const CAR: SequenceStrategy = { strategy: "car" };
const laneHours = (r: EtaRun): SequenceStrategy => (r.time < "21:00" ? SOUTHBOUND : CAR);

describe("isPrimeMinute", () => {
  it.each([
    ["12:19", 59, false],
    ["12:20", 0, true],
    ["12:20", 59, true],
    ["12:21", 0, false],
  ])("a 13:30 run primes in the minute 70 minutes before it: %s:%s → %s", (hhmm, seconds, expected) => {
    // Act & Assert
    expect(isPrimeMinute(run("13:30"), at(hhmm, seconds))).toBe(expected);
  });
});

describe("toModelGroups", () => {
  it("A mixed window: a bus-lane group and a car group, each with its fixed and window runs", () => {
    // Arrange
    const work = { fix: [run("20:30")], inWindow: [run("20:50"), run("21:10")] };

    // Act
    const groups = toModelGroups(work, laneHours);

    // Assert
    expect(groups).toEqual([
      { strategy: SOUTHBOUND, fix: [run("20:30")], inWindow: [run("20:50")] },
      { strategy: CAR, fix: [], inWindow: [run("21:10")] },
    ]);
  });

  it("one group per direction of a bus-lane sequence", () => {
    // Arrange
    const work = { fix: [], inWindow: [run("10:00"), run("10:10")] };
    const byTime = (r: EtaRun): SequenceStrategy => (r.time === "10:00" ? SOUTHBOUND : { strategy: "busLane", direction: "northbound" });

    // Act
    const groups = toModelGroups(work, byTime);

    // Assert
    expect(groups.map((g) => g.strategy)).toEqual([SOUTHBOUND, { strategy: "busLane", direction: "northbound" }]);
  });

  it("no due run, no group", () => {
    // Act & Assert
    expect(toModelGroups({ fix: [], inWindow: [] }, laneHours)).toEqual([]);
  });
});

describe("toBusLaneOffsets", () => {
  it.each([
    [[0, 4620], 1080, [0, 3780]],
    [[0, 4620, 4740], 1080, [0, 3780, 3900]],
    [[0, 4620], 2400, [0, 5100]],
    [[0, 4620], 1080.6, [0, 3781]],
  ])("offsets %j with a %s s bus-lane corridor (car: 1920 s) → %j", (stopOffsetsSec, corridorSec, expected) => {
    // Act & Assert
    expect(toBusLaneOffsets({ stopOffsetsSec, corridorCarSec: 1920 }, corridorSec)).toEqual(expected);
  });
});

describe("toLiveWork", () => {
  it("fixes a late run with its last live value's travel model", () => {
    // Arrange
    const travel = { model: "busLane" as const, corridorCarSec: 1920, corridorSec: 1080, spanCount: 6, coverage: 0.8 };
    const last: ShuttleEtaDoc = liveDoc(run("10:00"), { offsetsSec: [0, 3780], fetchedAt: at("09:55"), travel });

    // Act
    const work = toLiveWork([run("10:00")], new Map([[etaDocId(run("10:00"), "live"), last]]), at("10:10"));

    // Assert
    expect(work.fallback).toEqual([expect.objectContaining({ frozen: true, frozenAt: at("10:10"), offsetsSec: [0, 3780], travel })]);
  });
});
