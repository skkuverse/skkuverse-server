/**
 * SubwaySeoulPoller registers `subway-seoul` every 10 s and `subway-trainmap`
 * every 15 s with SUBWAY on, and nothing with it off. Its ticks run the real
 * `seoul` provider over scripted clients (the fakes in
 * __tests__/helpers/fakes/subway/) into the real tracker over
 * FakeSubwayRepository, at a scripted Clock. What it guards: no upstream call
 * outside the service window (03:00 KST; 05:00 to 01:10 after a weekday, to
 * 00:30 after a Saturday); a source's daily ceiling rejects its ticks, calling
 * nothing, until 00:00 KST; a failing source rejects its own ticks only;
 * and within one tick, what answered reaches the tracker before the tick
 * rejects with the failure, so a failing line loses no other line's trains.
 * Each ceiling is about twice a weekday's calls as the registry derives them
 * (ADR 0017, D3), so a station that outgrows one fails here. Over the
 * 2026-10-25 captures of Sadang, Geumjeong and Jongno 5-ga (ADR 0022 D4), one
 * API tick serves every line there: trains standing at the platform, a
 * countdown live where the operator publishes one, and Geumjeong's Korail
 * sections estimated.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import fs from "fs";
import path from "path";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { storedSubwayTimetableService } from "../../../__tests__/helpers/subway/timetables";
import { FakeSubwaySeoulApiClient } from "../../../__tests__/helpers/fakes/subway/subway-seoul-api.client.fake";
import { FakeSubwaySeoulTrainmapClient } from "../../../__tests__/helpers/fakes/subway/subway-seoul-trainmap.client.fake";
import { FakeSubwayRepository } from "../../../__tests__/helpers/fakes/subway/subway.repository.fake";
import type { Clock } from "../../infra/clock";
import config from "../../infra/config";
import logger from "../../infra/logger";
import type { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { SubwayCountdownService } from "../countdown/subway-countdown.service";
import { FakeSubwayTopologyRepository } from "../../../__tests__/helpers/fakes/subway/subway-topology.repository.fake";
import { storedSubwayTopologyRepository, storedSubwayTopologyService, subwayTopologyFixture } from "../../../__tests__/helpers/subway/topology";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import { SubwayMatchingService } from "../matching/subway-matching.service";
import type { SubwaySeoulApiClient } from "../seoul-api/subway-seoul-api.client";
import { SubwaySeoulApiService } from "../seoul-api/subway-seoul-api.service";
import type { SubwaySeoulTrainmapClient } from "../seoul-trainmap/subway-seoul-trainmap.client";
import { SubwaySeoulTrainmapService } from "../seoul-trainmap/subway-seoul-trainmap.service";
import { SUBWAY_LINES, SUBWAY_STATIONS } from "../subway.constants";
import { SubwayStateService } from "../state/subway-state.service";
import type { SubwayRepository } from "../subway.repository";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import type { TrackedTick } from "../tracking/subway-tracking.types";
import { SubwaySeoulPoller } from "./subway-seoul.poller";
import { SubwaySeoulService } from "./subway-seoul.service";

const FIXTURES = path.join(__dirname, "../../../__tests__/nest/subway/fixtures");
const rows = <T>(name: string, list: string): T[] => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"))[list];
const page = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const subway = config.subway as { enabled: boolean; apiDailyCap: number; trainMapDailyCap: number };

type Tick = () => Promise<unknown>;

// WHY: the train map is one page for every line (line=0); the line 1 and line 4 captures joined stand for it.
const ALL_LINES = "0";
const LINES_1_AND_4_PAGE = `${page("trainmap-line1.html")}${page("trainmap-line4.html")}`;
const BROKEN_LINE_4 = '<div class="4line_metro"><div class="T0421_Q_9_v2 tip" title="4050열차  동대문 도착 진접행"></div></div>';
// WHY: one position call per registered line and one arrival call per registered station, however many the registry holds.
const API_CALLS_PER_TICK = SUBWAY_LINES.length + SUBWAY_STATIONS.length;
// WHY: 05:00 to 01:10 KST, the weekday window the service-window tests below pin; a sibling's constants are not importable.
const WEEKDAY_WINDOW_SEC = (20 * 60 + 10) * 60;
// WHY: the intervals the registration test pins (10 s and 15 s); a crawl is one request (line=0).
const WEEKDAY_API_CALLS = API_CALLS_PER_TICK * (WEEKDAY_WINDOW_SEC / 10);
const WEEKDAY_CRAWLS = WEEKDAY_WINDOW_SEC / 15;

function setup(startIso: string, topology = storedSubwayTopologyRepository()) {
  let now = new Date(startIso);
  const clock = { now: () => now } as Clock;
  const apiClient = new FakeSubwaySeoulApiClient();
  apiClient.positions.set("1호선", rows("realtime-position-line1.json", "realtimePositionList"));
  apiClient.positions.set("4호선", rows("realtime-position-line4.json", "realtimePositionList"));
  apiClient.arrivals.set("혜화", rows("realtime-arrival-hyehwa.json", "realtimeArrivalList"));
  const trainmapClient = new FakeSubwaySeoulTrainmapClient();
  trainmapClient.pages.set(ALL_LINES, LINES_1_AND_4_PAGE);
  const seoul = new SubwaySeoulService(
    new SubwaySeoulApiService(asReal<SubwaySeoulApiClient>(apiClient)),
    new SubwaySeoulTrainmapService(asReal<SubwaySeoulTrainmapClient>(trainmapClient)),
    clock,
    storedSubwayTopologyService(topology, clock),
  );
  const timetable = storedSubwayTimetableService({ clock });
  const tracking = new SubwayTrackingService(new SubwayStateService(asReal<SubwayRepository>(new FakeSubwayRepository())), timetable, new SubwayEstimateService(new SubwayCountdownService()), clock);
  new SubwayMatchingService(tracking, clock).onModuleInit();
  const registerPoller = jest.fn();
  new SubwaySeoulPoller({ registerPoller } as unknown as PollerRegistryService, seoul, tracking).onModuleInit();
  const tickOf = (name: string): Tick => registerPoller.mock.calls.find((c) => c[2] === name)?.[0] as Tick;
  const tickAt = (iso: string, name: string): Promise<unknown> => {
    now = new Date(iso);
    return tickOf(name)();
  };
  return { registerPoller, apiClient, trainmapClient, tracking, tickAt };
}

// The API key is a read-only getter (ADR 0012, D4); the tests change only these.
const restore = { enabled: subway.enabled, apiDailyCap: subway.apiDailyCap, trainMapDailyCap: subway.trainMapDailyCap };
afterEach(() => {
  Object.assign(subway, restore);
  jest.clearAllMocks();
});

describe("SubwaySeoulPoller.onModuleInit", () => {
  it("SUBWAY=off registers nothing and says so once", () => {
    // Arrange
    subway.enabled = false;

    // Act
    const { registerPoller } = setup("2026-10-16T11:00:00Z");

    // Assert
    expect(registerPoller).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ event: "subway.seoul.disabled" }, expect.any(String));
  });

  it("registers subway-seoul every 10 s and subway-trainmap every 15 s", () => {
    // Arrange
    subway.enabled = true;

    // Act
    const { registerPoller } = setup("2026-10-16T11:00:00Z");

    // Assert
    expect(registerPoller.mock.calls.map((c) => [c[2], c[1]])).toEqual([
      ["subway-seoul", 10_000],
      ["subway-trainmap", 15_000],
    ]);
  });
});

describe("SubwaySeoulPoller ticks only in the service window", () => {
  beforeEach(() => {
    subway.enabled = true;
  });

  it("calls no upstream at 03:00 KST", async () => {
    // Arrange
    const { apiClient, trainmapClient, tickAt } = setup("2026-10-16T18:00:00Z");

    // Act
    await tickAt("2026-10-16T18:00:00Z", "subway-seoul");
    await tickAt("2026-10-16T18:00:00Z", "subway-trainmap");

    // Assert
    expect([apiClient.calls, trainmapClient.calls]).toEqual([[], []]);
  });

  it.each([
    ["04:59:59 on a Friday", "2026-10-15T19:59:59Z", 0],
    ["05:00 on a Friday", "2026-10-15T20:00:00Z", API_CALLS_PER_TICK],
    ["01:09:59 after a Friday", "2026-10-16T16:09:59Z", API_CALLS_PER_TICK],
    ["01:10 after a Friday", "2026-10-16T16:10:00Z", 0],
    ["05:00 on a Saturday", "2026-10-16T20:00:00Z", API_CALLS_PER_TICK],
    ["00:29:59 after a Saturday", "2026-10-17T15:29:59Z", API_CALLS_PER_TICK],
    ["00:30 after a Saturday", "2026-10-17T15:30:00Z", 0],
  ])("makes the API's calls at %s: %i", async (_label, iso, callCount) => {
    // Arrange
    const { apiClient, tickAt } = setup(iso);

    // Act
    await tickAt(iso, "subway-seoul");

    // Assert
    expect(apiClient.calls).toHaveLength(callCount);
  });
});

describe("SubwaySeoulPoller daily ceilings", () => {
  beforeEach(() => {
    subway.enabled = true;
  });

  it("rejects the API's ticks once its ceiling is reached, calling nothing, until 00:00 KST", async () => {
    // Arrange
    subway.apiDailyCap = API_CALLS_PER_TICK;
    const { apiClient, tickAt } = setup("2026-10-16T14:59:00Z");
    await tickAt("2026-10-16T14:59:00Z", "subway-seoul");

    // Act
    const atCeiling = tickAt("2026-10-16T14:59:59Z", "subway-seoul");
    await expect(atCeiling).rejects.toMatchObject({ name: "DailyCapError", provider: "seoul-subway-api", cap: API_CALLS_PER_TICK });
    const callsAtCeiling = apiClient.calls.length;
    await tickAt("2026-10-16T15:00:00Z", "subway-seoul");

    // Assert
    expect(callsAtCeiling).toBe(API_CALLS_PER_TICK);
    expect(apiClient.calls).toHaveLength(2 * API_CALLS_PER_TICK);
  });

  it("keeps the train map's ceiling apart from the API's, one taken per crawl's single request", async () => {
    // Arrange
    subway.trainMapDailyCap = 1;
    const { apiClient, tickAt } = setup("2026-10-16T11:00:00Z");
    await tickAt("2026-10-16T11:00:00Z", "subway-trainmap");

    // Act
    const atCeiling = tickAt("2026-10-16T11:00:15Z", "subway-trainmap");
    await expect(atCeiling).rejects.toMatchObject({ name: "DailyCapError", provider: "seoul-trainmap", cap: 1 });
    await tickAt("2026-10-16T11:00:20Z", "subway-seoul");

    // Assert
    expect(apiClient.calls).toHaveLength(API_CALLS_PER_TICK);
  });

  it("Poller without a topology: rejects the API's ticks before any call, taking nothing from its ceiling", async () => {
    // Arrange
    subway.apiDailyCap = API_CALLS_PER_TICK;
    const topology = new FakeSubwayTopologyRepository();
    const { apiClient, tickAt } = setup("2026-10-16T11:00:00Z", topology);

    // Act
    const unread = await tickAt("2026-10-16T11:00:00Z", "subway-seoul").catch((err: unknown) => err);
    const callsUnread = apiClient.calls.length;
    topology.storeTopology(subwayTopologyFixture());
    await tickAt("2026-10-16T11:01:00Z", "subway-seoul");

    // Assert
    expect(unread).toMatchObject({ code: "SUBWAY_TOPOLOGY_UNAVAILABLE", httpStatus: 503 });
    expect(callsUnread).toBe(0);
    expect(apiClient.calls).toHaveLength(API_CALLS_PER_TICK);
  });
});

describe("SubwaySeoulPoller daily ceilings against a weekday's calls", () => {
  it("counts a weekday's calls from the registry: 7,260 API ticks and 4,840 crawls in the 72,600 s window", () => {
    // Act & Assert
    expect([WEEKDAY_WINDOW_SEC, WEEKDAY_API_CALLS / API_CALLS_PER_TICK, WEEKDAY_CRAWLS]).toEqual([72_600, 7_260, 4_840]);
  });

  it.each([
    ["seoul-subway-api", () => subway.apiDailyCap, WEEKDAY_API_CALLS],
    ["seoul-trainmap", () => subway.trainMapDailyCap, WEEKDAY_CRAWLS],
  ])("keeps %s's ceiling between 1.8 and 2.5 times a weekday's calls", (_source, ceilingOf, weekdayCalls) => {
    // Act
    const ratio = ceilingOf() / weekdayCalls;

    // Assert
    expect(ratio).toBeGreaterThanOrEqual(1.8);
    expect(ratio).toBeLessThanOrEqual(2.5);
  });
});

describe("SubwaySeoulPoller sources fail apart", () => {
  beforeEach(() => {
    subway.enabled = true;
  });

  it("rejects the train map's tick on a page it cannot parse while the API's tick resolves", async () => {
    // Arrange
    const { trainmapClient, tickAt } = setup("2026-10-16T11:00:00Z");
    trainmapClient.pages.set(ALL_LINES, "<html>점검 중</html>");

    // Act
    const trainMapTick = tickAt("2026-10-16T11:00:00Z", "subway-trainmap");
    await expect(trainMapTick).rejects.toMatchObject({ source: "seoul-trainmap", code: "unexpected_shape" });

    // Assert
    await expect(tickAt("2026-10-16T11:00:10Z", "subway-seoul")).resolves.toBeUndefined();
  });
});

describe("SubwaySeoulPoller tracks what answered before it reports a failure", () => {
  beforeEach(() => {
    subway.enabled = true;
  });

  function listenTo(tracking: SubwayTrackingService): TrackedTick[] {
    const ticks: TrackedTick[] = [];
    tracking.addTickListener(async (tick) => {
      ticks.push(tick);
    });
    return ticks;
  }
  const eventsAt = (ticks: readonly TrackedTick[], platformId: string): string[] =>
    ticks.flatMap((tick) => tick.platforms.filter((s) => s.platformId === platformId).flatMap((s) => s.events.map((e) => `${e.trainNo} ${e.state}`)));

  it("tracks line 1's train-map events and still rejects the tick when line 4's block does not parse", async () => {
    // Arrange
    const { trainmapClient, tracking, tickAt } = setup("2026-10-16T11:45:00Z");
    trainmapClient.pages.set(ALL_LINES, `${page("trainmap-line1.html")}${BROKEN_LINE_4}`);
    const ticks = listenTo(tracking);

    // Act
    const trainMapTick = tickAt("2026-10-16T11:45:00Z", "subway-trainmap");

    // Assert
    await expect(trainMapTick).rejects.toMatchObject({ source: "seoul-trainmap", code: "unexpected_shape" });
    expect(eventsAt(ticks, "KR-1-P153")).toContain("0493 departed");
    expect(eventsAt(ticks, "S1-4-420")).toEqual([]);
  });

  it("tracks both lines' API events and still rejects the tick when 혜화's arrivals call fails", async () => {
    // Arrange
    // At the line 4 fixture's capture time, so its rows are not too far ahead to track.
    const { apiClient, tracking, tickAt } = setup("2026-10-16T13:28:00Z");
    const failure = new Error("realtimeStationArrival: HTTP 500");
    apiClient.arrivals.set("혜화", failure);
    const ticks = listenTo(tracking);

    // Act
    const apiTick = tickAt("2026-10-16T13:28:00Z", "subway-seoul");

    // Assert
    await expect(apiTick).rejects.toBe(failure);
    expect(eventsAt(ticks, "S1-4-420")).toEqual(expect.arrayContaining(["4204 arrived", "4707 arrived"]));
  });

  it("tracks nothing and rejects the tick when every line fails", async () => {
    // Arrange
    const { trainmapClient, tracking, tickAt } = setup("2026-10-16T11:45:00Z");
    trainmapClient.pages.set(ALL_LINES, "<html>점검 중</html>");
    const ticks = listenTo(tracking);

    // Act
    const trainMapTick = tickAt("2026-10-16T11:45:00Z", "subway-trainmap");

    // Assert
    await expect(trainMapTick).rejects.toMatchObject({ source: "seoul-trainmap" });
    expect(ticks).toEqual([]);
  });
});

describe("SubwaySeoulPoller over the 2026-10-25 captures at 사당, 금정 and 종로5가", () => {
  const CAPTURED_AT = "2026-10-25T03:23:20Z";

  function setupCaptured() {
    const { apiClient, tracking, tickAt } = setup(CAPTURED_AT);
    apiClient.positions.set("1호선", rows("realtime-position-line1-2026-10-25.json", "realtimePositionList"));
    apiClient.positions.set("2호선", rows("realtime-position-line2-2026-10-25.json", "realtimePositionList"));
    apiClient.positions.set("4호선", rows("realtime-position-line4-2026-10-25.json", "realtimePositionList"));
    apiClient.arrivals.set("혜화", []);
    apiClient.arrivals.set("사당", rows("realtime-arrival-sadang.json", "realtimeArrivalList"));
    apiClient.arrivals.set("금정", rows("realtime-arrival-geumjeong.json", "realtimeArrivalList"));
    apiClient.arrivals.set("종로5가", rows("realtime-arrival-jongno5ga.json", "realtimeArrivalList"));
    const ticks: TrackedTick[] = [];
    tracking.addTickListener(async (tick) => {
      ticks.push(tick);
    });
    return { ticks, tickAt };
  }

  const kst = (time: string): Date => new Date(`2026-10-25T${time}+09:00`);
  const trainsOf = (ticks: readonly TrackedTick[], platformId: string, direction: "up" | "down") =>
    ticks.flatMap((tick) => tick.platforms.filter((p) => p.platformId === platformId).flatMap((p) => p.arrivals.directions[direction]));

  it("serves each new platform's trains from one API tick: 사당's trains standing there and line 2's countdown live", async () => {
    // Arrange
    subway.enabled = true;
    const { ticks, tickAt } = setupCaptured();

    // Act
    await tickAt(CAPTURED_AT, "subway-seoul");

    // Assert
    expect(trainsOf(ticks, "S1-4-433", "up")[0]).toMatchObject({ trainNo: "4566", position: { stationId: "S1-4-433", state: "arrived" } });
    expect(trainsOf(ticks, "S1-4-433", "down")[0]).toMatchObject({ trainNo: "4565", position: { stationId: "S1-4-433", state: "arrived" } });
    expect(trainsOf(ticks, "S1-2-226", "down")[0]).toMatchObject({ trainNo: "2157", source: "live", arrivalAt: kst("12:26:12") });
  });

  it("serves 종로5가's countdown live and 금정's trains, whose Korail sections publish none, estimated", async () => {
    // Arrange
    subway.enabled = true;
    const { ticks, tickAt } = setupCaptured();

    // Act
    await tickAt(CAPTURED_AT, "subway-seoul");

    // Assert
    expect(trainsOf(ticks, "S1-1-154", "up").map((train) => [train.trainNo, train.source])).toEqual([
      ["0636", "estimated"],
      ["0072", "live"],
      ["1916", "estimated"],
    ]);
    expect(trainsOf(ticks, "S1-1-154", "up")[1]?.arrivalAt).toEqual(kst("12:26:45"));
    expect(trainsOf(ticks, "KR-1-P149", "down")[0]).toMatchObject({ trainNo: "1919", express: true, position: { stationId: "KR-1-P149", state: "arrived" } });
    const geumjeong = ["KR-1-P149", "KR-4-443"].flatMap((id) => [...trainsOf(ticks, id, "up"), ...trainsOf(ticks, id, "down")]);
    expect(geumjeong.map((train) => train.source)).not.toContain("live");
    expect(geumjeong).toHaveLength(12);
  });
});
