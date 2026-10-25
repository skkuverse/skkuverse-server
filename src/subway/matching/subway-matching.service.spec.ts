/**
 * SubwayMatchingService over a fixed Clock and FakeSubwayTrackingService, through the run matcher it registers
 * with the tracker, called with a synthetic platform schedule as a tick would: it matches the events of the
 * schedule's line, and only those, to runs, and remembers each line's matches across ticks in memory, so a
 * trainset keeps its run on the next tick while a new instance, as after a restart, starts with none; the
 * events no run takes are logged as `subway.matching.unmatched`, at most once every 10 minutes per line, with
 * how many lines were suppressed. The timetable is synthetic, hand-written in the shape
 * scripts/subway-timetable/convert.py writes for the Shinbundang line, on a shortened route.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { FakeSubwayTrackingService } from "../../../__tests__/helpers/fakes/subway/subway-tracking.service.fake";
import { logText } from "../../../__tests__/helpers/log-text";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import type { SubwayDirection, SubwayPlatform, TrainEvent } from "../subway.types";
import type { LineRoutes, PlatformSchedule, ScheduledTrain } from "../timetable/subway-timetable.types";
import type { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { SubwayMatchingService } from "./subway-matching.service";

const CHEONGGYESAN = "DX-D1-4310";
const PANGYO = "DX-D1-4311";
const JEONGJA = "DX-D1-4312";
const MIGEUM = "DX-D1-D13";
const DOWN_ROUTE = [CHEONGGYESAN, PANGYO, JEONGJA, MIGEUM];
const ROUTES: LineRoutes = { down: DOWN_ROUTE, up: [...DOWN_ROUTE].reverse() };

const at = (kst: string): Date => new Date(`2026-10-19T${kst}+09:00`);

function run(runNo: string, direction: SubwayDirection, firstKst: string, destination: string): ScheduledTrain {
  const stops = ROUTES[direction].map((platformId, index) => {
    const calledAt = new Date(at(firstKst).getTime() + index * 120_000);
    return { platformId, arrivalAt: calledAt, departureAt: calledAt };
  });
  return { trainNo: runNo, direction, destination, express: false, stops };
}

// Pangyo at 21:03 and 21:11 down, Migeum at 21:12 up.
const TRAINS = [run("1031", "down", "21:01:00", "광교"), run("1033", "down", "21:09:00", "광교"), run("1032", "up", "21:12:00", "신사")];

function schedule(line: string): PlatformSchedule {
  const direction = (upstreamPlatformIds: string[], nextPlatformId: string) => ({
    name: { ko: "방면", en: "Toward", zh: "方向" },
    upstreamPlatformIds,
    watchedPlatformIds: [],
    nextPlatformId,
  });
  const platform: SubwayPlatform = {
    id: JEONGJA,
    line,
    timetable: { source: "shinbundang" },
    directions: { up: direction([MIGEUM], PANGYO), down: direction([PANGYO, CHEONGGYESAN], MIGEUM) },
  };
  return { platform, serviceDate: "2026-10-19", dayType: "weekday", lineRoutes: ROUTES, trains: TRAINS };
}

function event(trainset: string, platformId: string, kst: string, destination = "광교"): TrainEvent {
  return { trainNo: trainset, platformId, state: "arrived", stateChangedAt: at(kst), destination };
}

function setup() {
  let now = at("21:04:15");
  const clock = { now: () => now } as Clock;
  const tracking = new FakeSubwayTrackingService();
  new SubwayMatchingService(asReal<SubwayTrackingService>(tracking), clock).onModuleInit();
  const tickAt = (kst: string, events: TrainEvent[], line = "D1"): TrainEvent[] => {
    now = at(kst);
    if (!tracking.runMatcher) throw new Error("no run matcher registered");
    return tracking.runMatcher(schedule(line), events, now);
  };
  return { tickAt };
}

const runNos = (events: readonly TrainEvent[]): string[] => events.map((e) => e.trainNo);

afterEach(() => {
  jest.clearAllMocks();
});

describe("SubwayMatchingService.onModuleInit", () => {
  it("numbers a trainset's event by its run, and keeps that run on the next tick though a later run is now nearer", () => {
    // Arrange
    const { tickAt } = setup();

    // Act
    const first = tickAt("21:04:15", [event("18", PANGYO, "21:04:10")]);
    const next = tickAt("21:13:35", [event("18", JEONGJA, "21:13:30")]);

    // Assert
    expect(runNos(first)).toEqual(["1031"]);
    expect(runNos(next)).toEqual(["1031"]);
  });

  it("starts with no match after a restart, so the trainset takes the run nearest its event", () => {
    // Arrange
    const before = setup();
    before.tickAt("21:04:15", [event("18", PANGYO, "21:04:10")]);
    const restarted = setup();

    // Act
    const next = restarted.tickAt("21:13:35", [event("18", JEONGJA, "21:13:30")]);

    // Assert
    expect(runNos(next)).toEqual(["1033"]);
  });

  it("matches only the events on the schedule's line, and neither returns nor reports another line's", () => {
    // Arrange
    const { tickAt } = setup();
    const otherLine = event("0493", "KR-1-P153", "21:04:10", "서동탄");

    // Act
    const events = tickAt("21:04:15", [otherLine, event("18", PANGYO, "21:04:10")]);

    // Assert
    expect(runNos(events)).toEqual(["1031"]);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("remembers matches per line", () => {
    // Arrange
    const { tickAt } = setup();
    tickAt("21:04:15", [event("18", PANGYO, "21:04:10")], "D1");

    // Act
    const otherLine = tickAt("21:13:35", [event("18", JEONGJA, "21:13:30")], "D2");

    // Assert
    expect(runNos(otherLine)).toEqual(["1033"]);
  });

  it("logs the unmatched trainsets once per line within 10 minutes, then again with the lines suppressed", () => {
    // Arrange
    const { tickAt } = setup();
    const lost = [event("3", PANGYO, "22:30:00"), event("7", MIGEUM, "22:30:00", "모란")];

    // Act
    tickAt("22:30:05", lost);
    tickAt("22:39:00", lost);
    tickAt("22:39:00", lost, "D2");
    tickAt("22:40:05", lost);

    // Assert
    const lines = jest.mocked(logger.info).mock.calls;
    expect(lines.map(([fields]) => (fields as { event?: string }).event)).toEqual(Array(3).fill("subway.matching.unmatched"));
    expect(lines.map((call) => logText(call))).toEqual([
      expect.stringContaining("D1; 2; 3; 7; 0"),
      expect.stringContaining("D2; 2; 3; 7; 0"),
      expect.stringContaining("D1; 2; 3; 7; 1"),
    ]);
  });
});
