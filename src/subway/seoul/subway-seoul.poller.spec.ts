/**
 * SubwaySeoulPoller registers `subway-seoul` every 10 s and `subway-trainmap`
 * every 15 s with SUBWAY on, and nothing with it off. Its ticks run the real
 * `seoul` provider over scripted clients (the fakes in
 * __tests__/helpers/fakes/subway/) into the real tracker over
 * FakeSubwayRepository, at a scripted Clock. What it guards: no upstream call
 * outside the service window (03:00 KST; 05:00 to 01:10 after a weekday, to
 * 00:30 after a Saturday); a source's daily ceiling rejects its ticks, calling
 * nothing, until 00:00 KST; and a failing source rejects its own ticks only.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import fs from "fs";
import path from "path";
import { FakeHolidaysService } from "../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { FakeSubwaySeoulApiClient } from "../../../__tests__/helpers/fakes/subway/subway-seoul-api.client.fake";
import { FakeSubwaySeoulTrainmapClient } from "../../../__tests__/helpers/fakes/subway/subway-seoul-trainmap.client.fake";
import { FakeSubwayRepository } from "../../../__tests__/helpers/fakes/subway/subway.repository.fake";
import type { HolidaysService } from "../../holidays/holidays.service";
import type { Clock } from "../../infra/clock";
import config from "../../infra/config";
import logger from "../../infra/logger";
import type { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import type { SubwaySeoulApiClient } from "../seoul-api/subway-seoul-api.client";
import { SubwaySeoulApiService } from "../seoul-api/subway-seoul-api.service";
import type { SubwaySeoulTrainmapClient } from "../seoul-trainmap/subway-seoul-trainmap.client";
import { SubwaySeoulTrainmapService } from "../seoul-trainmap/subway-seoul-trainmap.service";
import type { SubwayRepository } from "../subway.repository";
import { SubwayTimetableService } from "../timetable/subway-timetable.service";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { SubwaySeoulPoller } from "./subway-seoul.poller";
import { SubwaySeoulService } from "./subway-seoul.service";

const FIXTURES = path.join(__dirname, "../../../__tests__/nest/subway/fixtures");
const rows = <T>(name: string, list: string): T[] => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"))[list];
const page = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const subway = config.subway as { enabled: boolean; apiDailyCap: number; trainMapDailyCap: number };

type Tick = () => Promise<unknown>;

function setup(startIso: string) {
  let now = new Date(startIso);
  const clock = { now: () => now } as Clock;
  const apiClient = new FakeSubwaySeoulApiClient();
  apiClient.positions.set("1호선", rows("realtime-position-line1.json", "realtimePositionList"));
  apiClient.positions.set("4호선", rows("realtime-position-line4.json", "realtimePositionList"));
  apiClient.arrivals.set("혜화", rows("realtime-arrival-hyehwa.json", "realtimeArrivalList"));
  const trainmapClient = new FakeSubwaySeoulTrainmapClient();
  trainmapClient.pages.set("1", page("trainmap-line1.html"));
  trainmapClient.pages.set("4", page("trainmap-line4.html"));
  const seoul = new SubwaySeoulService(
    new SubwaySeoulApiService(asReal<SubwaySeoulApiClient>(apiClient)),
    new SubwaySeoulTrainmapService(asReal<SubwaySeoulTrainmapClient>(trainmapClient)),
    clock,
  );
  const timetable = new SubwayTimetableService(asReal<HolidaysService>(new FakeHolidaysService()));
  const tracking = new SubwayTrackingService(asReal<SubwayRepository>(new FakeSubwayRepository()), timetable, new SubwayEstimateService(), clock);
  const registerPoller = jest.fn();
  new SubwaySeoulPoller({ registerPoller } as unknown as PollerRegistryService, seoul, tracking).onModuleInit();
  const tickOf = (name: string): Tick => registerPoller.mock.calls.find((c) => c[2] === name)?.[0] as Tick;
  const tickAt = (iso: string, name: string): Promise<unknown> => {
    now = new Date(iso);
    return tickOf(name)();
  };
  return { registerPoller, apiClient, trainmapClient, tickAt };
}

const restore = { ...subway };
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
    ["05:00 on a Friday", "2026-10-15T20:00:00Z", 4],
    ["01:09:59 after a Friday", "2026-10-16T16:09:59Z", 4],
    ["01:10 after a Friday", "2026-10-16T16:10:00Z", 0],
    ["05:00 on a Saturday", "2026-10-16T20:00:00Z", 4],
    ["00:29:59 after a Saturday", "2026-10-17T15:29:59Z", 4],
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
    subway.apiDailyCap = 4;
    const { apiClient, tickAt } = setup("2026-10-16T14:59:00Z");
    await tickAt("2026-10-16T14:59:00Z", "subway-seoul");

    // Act
    const atCeiling = tickAt("2026-10-16T14:59:59Z", "subway-seoul");
    await expect(atCeiling).rejects.toMatchObject({ name: "DailyCapError", provider: "seoul-subway-api", cap: 4 });
    const callsAtCeiling = apiClient.calls.length;
    await tickAt("2026-10-16T15:00:00Z", "subway-seoul");

    // Assert
    expect(callsAtCeiling).toBe(4);
    expect(apiClient.calls).toHaveLength(8);
  });

  it("keeps the train map's ceiling apart from the API's", async () => {
    // Arrange
    subway.trainMapDailyCap = 2;
    const { apiClient, tickAt } = setup("2026-10-16T11:00:00Z");
    await tickAt("2026-10-16T11:00:00Z", "subway-trainmap");

    // Act
    const atCeiling = tickAt("2026-10-16T11:00:15Z", "subway-trainmap");
    await expect(atCeiling).rejects.toMatchObject({ name: "DailyCapError", provider: "seoul-trainmap", cap: 2 });
    await tickAt("2026-10-16T11:00:20Z", "subway-seoul");

    // Assert
    expect(apiClient.calls).toHaveLength(4);
  });
});

describe("SubwaySeoulPoller sources fail apart", () => {
  beforeEach(() => {
    subway.enabled = true;
  });

  it("rejects the train map's tick on a page it cannot parse while the API's tick resolves", async () => {
    // Arrange
    const { trainmapClient, tickAt } = setup("2026-10-16T11:00:00Z");
    trainmapClient.pages.set("4", "<html>점검 중</html>");

    // Act
    const trainMapTick = tickAt("2026-10-16T11:00:00Z", "subway-trainmap");
    await expect(trainMapTick).rejects.toMatchObject({ source: "seoul-trainmap", code: "unexpected_shape" });

    // Assert
    await expect(tickAt("2026-10-16T11:00:10Z", "subway-seoul")).resolves.toBeUndefined();
  });
});
