/**
 * Run matching on a line whose upstream numbers trainsets, not trips (design D7): an event's direction comes
 * from a destination the timetable names in one direction only; a new trainset takes the unmatched run of
 * that direction, calling where it is seen, whose scheduled time for the event is nearest the event's time
 * within −120…+2,700 s, and never one that puts it ahead of a matched trainset in front of it or behind one
 * following it; a trainset keeps its run while it keeps its direction and the run calls where it is seen, and
 * releases it on a turnaround or after 15 minutes unseen; an event that matches no run is dropped and
 * reported. The timetable is synthetic, hand-written in the shape scripts/subway-timetable/convert.py writes
 * for the Shinbundang line (design D8): minute times, arrival equal to departure, runs numbered from 1001 down and 1002
 * up, on a shortened route.
 */
import { APPROACH_LEAD_MS } from "../subway.constants";
import type { SubwayDirection, TrainEvent } from "../subway.types";
import type { LineRoutes, ScheduledTrain } from "../timetable/subway-timetable.types";
import { matchRuns, toOneDirectionDestinations } from "./subway-matching.rules";
import type { MatchingTick, RunMatch } from "./subway-matching.types";

const CHEONGGYESAN = "DX-D1-4310";
const PANGYO = "DX-D1-4311";
const JEONGJA = "DX-D1-4312";
const MIGEUM = "DX-D1-D13";
const GWANGGYO = "DX-D1-4319";
const DOWN_ROUTE = [CHEONGGYESAN, PANGYO, JEONGJA, MIGEUM, GWANGGYO];
const ROUTES: LineRoutes = { down: DOWN_ROUTE, up: [...DOWN_ROUTE].reverse() };
const LEG_MS = 120_000;

const at = (kst: string): Date => new Date(`2026-10-19T${kst}+09:00`);
const plusSec = (instant: Date, seconds: number): Date => new Date(instant.getTime() + seconds * 1000);

function run(runNo: string, direction: SubwayDirection, firstKst: string, destination: string, stations?: readonly string[]): ScheduledTrain {
  const calls = stations ?? ROUTES[direction];
  const stops = calls.map((platformId, index) => {
    const calledAt = new Date(at(firstKst).getTime() + index * LEG_MS);
    return { platformId, arrivalAt: calledAt, departureAt: calledAt };
  });
  return { trainNo: runNo, direction, destination, express: false, stops };
}

// Pangyo at 21:03 and 21:11 down, Gwanggyo at 21:12 up, and a Jeongja short turn at Pangyo at 21:19.
const RUN_1031 = run("1031", "down", "21:01:00", "광교");
const RUN_1033 = run("1033", "down", "21:09:00", "광교");
const RUN_1032 = run("1032", "up", "21:12:00", "신사");
const RUN_1035 = run("1035", "down", "21:17:00", "정자", [CHEONGGYESAN, PANGYO, JEONGJA]);
const TRAINS = [RUN_1031, RUN_1033, RUN_1032, RUN_1035];

// Pangyo at 21:00 and 21:03 down: a three-minute headway.
const RUN_1001 = run("1001", "down", "20:58:00", "광교");
const RUN_1003 = run("1003", "down", "21:01:00", "광교");
const DENSE_TRAINS = [RUN_1001, RUN_1003, RUN_1032];

function event(trainset: string, platformId: string, kst: string | Date, destination = "광교", state: TrainEvent["state"] = "arrived"): TrainEvent {
  return { trainNo: trainset, platformId, state, stateChangedAt: typeof kst === "string" ? at(kst) : kst, destination };
}

function tick(overrides: Partial<MatchingTick> & Pick<MatchingTick, "events" | "now">): MatchingTick {
  return { matchesByTrainset: new Map(), trains: TRAINS, routes: ROUTES, ...overrides };
}

const matched = (runNo: string, direction: SubwayDirection, platformId: string, lastSeenAt: Date): RunMatch => ({ runNo, direction, platformId, lastSeenAt });

describe("toOneDirectionDestinations", () => {
  it("keeps the destinations the table runs in one direction and leaves out one it names both ways", () => {
    // Arrange
    const trains = [...TRAINS, run("1037", "up", "21:20:00", "정자", [GWANGGYO, MIGEUM, JEONGJA])];

    // Act
    const directionByDestination = toOneDirectionDestinations(trains);

    // Assert
    expect([...directionByDestination]).toEqual([
      ["광교", "down"],
      ["신사", "up"],
    ]);
  });
});

describe("matchRuns", () => {
  it.each([
    [-121, []],
    [-120, ["1031"]],
    [-119, ["1031"]],
    [2699, ["1031"]],
    [2700, ["1031"]],
    [2701, []],
  ])("matches a trainset arrived at 판교 %i s from the run's scheduled time only within −120…+2,700 s", (delaySec, runNos) => {
    // Arrange
    const seenAt = plusSec(at("21:03:00"), delaySec);

    // Act
    const runs = matchRuns(tick({ trains: [RUN_1031, RUN_1032], events: [event("18", PANGYO, seenAt)], now: seenAt }));

    // Assert
    expect(runs.events.map((e) => e.trainNo)).toEqual(runNos);
  });

  it.each([
    [-121, []],
    [-120, ["1031"]],
  ])("times an approach %i s off at the run's arrival less the approach lead", (delaySec, runNos) => {
    // Arrange
    const seenAt = plusSec(new Date(at("21:03:00").getTime() - APPROACH_LEAD_MS), delaySec);

    // Act
    const runs = matchRuns(tick({ trains: [RUN_1031, RUN_1032], events: [event("18", PANGYO, seenAt, "광교", "approaching")], now: seenAt }));

    // Assert
    expect(runs.events.map((e) => e.trainNo)).toEqual(runNos);
  });

  it("Trainset late at 판교: takes the 21:03 run, 70 s late, over the 21:11 one, and keeps the event as its", () => {
    // Arrange
    const seen = event("18", PANGYO, "21:04:10");

    // Act
    const runs = matchRuns(tick({ events: [seen], now: at("21:04:15") }));

    // Assert
    expect(runs.events).toEqual([{ ...seen, trainNo: "1031" }]);
    expect(runs.matchesByTrainset.get("18")).toEqual(matched("1031", "down", PANGYO, at("21:04:15")));
    expect(runs.unmatched).toEqual([]);
  });

  it("keeps a trainset's run while it holds its direction, though a later run is now nearer", () => {
    // Arrange
    const matchesByTrainset = new Map([["18", matched("1031", "down", PANGYO, at("21:04:15"))]]);

    // Act
    const runs = matchRuns(tick({ matchesByTrainset, events: [event("18", JEONGJA, "21:13:30")], now: at("21:13:35") }));

    // Assert
    expect(runs.events.map((e) => e.trainNo)).toEqual(["1031"]);
    expect(runs.matchesByTrainset.get("18")).toEqual(matched("1031", "down", JEONGJA, at("21:13:35")));
  });

  it("Turnaround at 광교: releases a southbound run when the trainset is seen bound for 신사, and matches a northbound one", () => {
    // Arrange
    const matchesByTrainset = new Map([["6", matched("1031", "down", MIGEUM, at("21:07:30"))]]);

    // Act
    const runs = matchRuns(tick({ matchesByTrainset, events: [event("6", GWANGGYO, "21:12:30", "신사")], now: at("21:12:35") }));

    // Assert
    expect(runs.events.map((e) => e.trainNo)).toEqual(["1032"]);
    expect(runs.matchesByTrainset.get("6")).toEqual(matched("1032", "up", GWANGGYO, at("21:12:35")));
  });

  it("releases a 정자 short turn's run when its trainset is seen beyond 정자, and matches a run calling there", () => {
    // Arrange
    const matchesByTrainset = new Map([["9", matched("1035", "down", CHEONGGYESAN, at("21:14:00"))]]);

    // Act
    const runs = matchRuns(tick({ matchesByTrainset, events: [event("9", MIGEUM, "21:15:00")], now: at("21:15:05") }));

    // Assert
    expect(runs.events.map((e) => e.trainNo)).toEqual(["1033"]);
  });

  it("No run in range: drops the event and reports it, and stores no match", () => {
    // Arrange
    const seen = event("3", PANGYO, "22:30:00");

    // Act
    const runs = matchRuns(tick({ events: [seen], now: at("22:30:05") }));

    // Assert
    expect(runs.events).toEqual([]);
    expect(runs.unmatched).toEqual([seen]);
    expect(runs.matchesByTrainset.has("3")).toBe(false);
  });

  it.each([
    ["names both directions", "정자"],
    ["the table never names", "모란"],
  ])("drops an event whose destination %s, keeping the trainset's run", (_label, destination) => {
    // Arrange
    const trains = [...TRAINS, run("1037", "up", "21:20:00", "정자", [GWANGGYO, MIGEUM, JEONGJA])];
    const matchesByTrainset = new Map([["18", matched("1031", "down", PANGYO, at("21:04:15"))]]);
    const seen = event("18", JEONGJA, "21:05:00", destination);

    // Act
    const runs = matchRuns(tick({ trains, matchesByTrainset, events: [seen], now: at("21:05:05") }));

    // Assert
    expect(runs.events).toEqual([]);
    expect(runs.unmatched).toEqual([seen]);
    expect(runs.matchesByTrainset.get("18")).toEqual(matched("1031", "down", PANGYO, at("21:04:15")));
  });

  it.each([
    ["15 minutes", 900_000, "1031"],
    ["15 minutes and 1 ms", 900_001, "1033"],
  ])("keeps the run of a trainset unseen for %s only within the hold", (_label, unseenMs, runNo) => {
    // Arrange
    const now = at("21:13:35");
    const matchesByTrainset = new Map([["18", matched("1031", "down", PANGYO, new Date(now.getTime() - unseenMs))]]);

    // Act
    const runs = matchRuns(tick({ matchesByTrainset, events: [event("18", JEONGJA, "21:13:30")], now }));

    // Assert
    expect(runs.events.map((e) => e.trainNo)).toEqual([runNo]);
  });

  it("forgets the run of a trainset unseen past the hold, which frees it for another trainset", () => {
    // Arrange
    const now = at("21:20:00");
    const matchesByTrainset = new Map([["18", matched("1031", "down", PANGYO, new Date(now.getTime() - 900_001))]]);

    // Act
    const runs = matchRuns(tick({ matchesByTrainset, events: [], now }));

    // Assert
    expect([...runs.matchesByTrainset.keys()]).toEqual([]);
  });

  it("matches the trainset behind to the next run when the trainset ahead holds the nearer one", () => {
    // Arrange
    const matchesByTrainset = new Map([["12", matched("1001", "down", JEONGJA, at("21:01:10"))]]);

    // Act
    const runs = matchRuns(tick({ trains: DENSE_TRAINS, matchesByTrainset, events: [event("14", PANGYO, "21:01:20")], now: at("21:01:25") }));

    // Assert
    expect(runs.events.map((e) => e.trainNo)).toEqual(["1003"]);
  });

  it("never gives one run to two trainsets, though both were last seen at the same station", () => {
    // Arrange
    const matchesByTrainset = new Map([["12", matched("1031", "down", PANGYO, at("21:03:10"))]]);
    const seen = event("14", PANGYO, "21:03:30");

    // Act
    const runs = matchRuns(tick({ matchesByTrainset, events: [seen], now: at("21:03:35") }));

    // Assert
    expect(runs.events).toEqual([]);
    expect(runs.matchesByTrainset.get("12")?.runNo).toBe("1031");
  });

  it("drops a trainset whose nearest free run would put it ahead of the trainset in front of it", () => {
    // Arrange
    const matchesByTrainset = new Map([["12", matched("1003", "down", JEONGJA, at("21:01:10"))]]);
    const seen = event("14", PANGYO, "21:01:20");

    // Act
    const runs = matchRuns(tick({ trains: DENSE_TRAINS, matchesByTrainset, events: [seen], now: at("21:01:25") }));

    // Assert
    expect(runs.events).toEqual([]);
    expect(runs.unmatched).toEqual([seen]);
  });

  it("drops a trainset whose nearest free run would put it behind the trainset following it", () => {
    // Arrange
    const matchesByTrainset = new Map([["14", matched("1001", "down", CHEONGGYESAN, at("21:04:30"))]]);
    const seen = event("12", JEONGJA, "21:04:30");

    // Act
    const runs = matchRuns(tick({ trains: DENSE_TRAINS, matchesByTrainset, events: [seen], now: at("21:04:35") }));

    // Assert
    expect(runs.events).toEqual([]);
    expect(runs.unmatched).toEqual([seen]);
  });

  it("matches the trainset in front first when two are new in one tick, so the one behind cannot take an earlier run", () => {
    // Arrange
    const behind = event("14", PANGYO, "21:01:20");
    const ahead = event("12", JEONGJA, "21:05:20");

    // Act
    const runs = matchRuns(tick({ trains: DENSE_TRAINS, events: [behind, ahead], now: at("21:05:25") }));

    // Assert
    expect(runs.events).toEqual([{ ...ahead, trainNo: "1003" }]);
    expect(runs.unmatched).toEqual([behind]);
  });

  it("matches a trainset by its newest event of the tick", () => {
    // Arrange
    const older = event("18", CHEONGGYESAN, "20:55:00");
    const newest = event("18", PANGYO, "21:04:10");

    // Act
    const runs = matchRuns(tick({ events: [newest, older], now: at("21:04:15") }));

    // Assert
    expect(runs.events).toEqual([{ ...newest, trainNo: "1031" }]);
  });
});
