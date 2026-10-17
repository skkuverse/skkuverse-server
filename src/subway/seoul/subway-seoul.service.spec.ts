/**
 * SubwaySeoulService, the `seoul` provider, over scripted clients (the typed
 * fakes in __tests__/helpers/fakes/subway/) fed the captured 2026-10-09 and
 * 2026-10-16 payloads, and a fixed Clock. What it guards: an API tick makes
 * the 4 calls of design D7 (positions of `1호선` and `4호선`, arrivals of
 * `성균관대` and `혜화`) and returns their events and countdown rows merged; a train-map
 * tick crawls lines 1 and 4 once each and stamps their events with the
 * Clock's time; each tick names its upstream as its source, so the tracker
 * keeps one upstream's countdown rows apart from the other's; and a failing
 * call is handed on beside what the tick's other calls answered, and only a
 * tick whose every call failed rejects (the poller then reports the failure,
 * subway-seoul.poller.spec.ts). The parsing and mapping
 * are the seoul-api and seoul-trainmap specs'; the daily ceilings are
 * subway-seoul.poller.spec.ts's.
 */
import fs from "fs";
import path from "path";
import { FakeSubwaySeoulApiClient } from "../../../__tests__/helpers/fakes/subway/subway-seoul-api.client.fake";
import { FakeSubwaySeoulTrainmapClient } from "../../../__tests__/helpers/fakes/subway/subway-seoul-trainmap.client.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import type { SubwaySeoulApiClient } from "../seoul-api/subway-seoul-api.client";
import { SubwaySeoulApiService } from "../seoul-api/subway-seoul-api.service";
import type { SubwaySeoulTrainmapClient } from "../seoul-trainmap/subway-seoul-trainmap.client";
import { SubwaySeoulTrainmapService } from "../seoul-trainmap/subway-seoul-trainmap.service";
import type { TrainEvent } from "../subway.types";
import { SubwaySeoulService } from "./subway-seoul.service";

const FIXTURES = path.join(__dirname, "../../../__tests__/nest/subway/fixtures");
const rows = <T>(name: string, list: string): T[] => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"))[list];
const page = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const NOW = new Date("2026-10-16T11:45:00Z");

function setup() {
  const apiClient = new FakeSubwaySeoulApiClient();
  apiClient.positions.set("1호선", rows("realtime-position-line1.json", "realtimePositionList"));
  apiClient.positions.set("4호선", rows("realtime-position-line4.json", "realtimePositionList"));
  apiClient.arrivals.set("성균관대", rows("realtime-arrival-sungkyunkwan.json", "realtimeArrivalList"));
  apiClient.arrivals.set("혜화", rows("realtime-arrival-hyehwa.json", "realtimeArrivalList"));
  const trainmapClient = new FakeSubwaySeoulTrainmapClient();
  trainmapClient.pages.set("1", page("trainmap-line1.html"));
  trainmapClient.pages.set("4", page("trainmap-line4.html"));
  const service = new SubwaySeoulService(
    new SubwaySeoulApiService(asReal<SubwaySeoulApiClient>(apiClient)),
    new SubwaySeoulTrainmapService(asReal<SubwaySeoulTrainmapClient>(trainmapClient)),
    { now: () => NOW } as Clock,
  );
  return { service, apiClient, trainmapClient };
}

const summary = (events: readonly TrainEvent[]) => events.map((e) => `${e.trainNo} ${e.platformId} ${e.state}`).sort();

describe("SubwaySeoulService.observeApi", () => {
  it("makes the 4 API calls of one tick and returns the merged events of both lines", async () => {
    // Arrange
    const { service, apiClient } = setup();

    // Act
    const observations = await service.observeApi();

    // Assert
    expect([...apiClient.calls].sort()).toEqual([
      "realtimePosition 1호선",
      "realtimePosition 4호선",
      "realtimeStationArrival 성균관대",
      "realtimeStationArrival 혜화",
    ]);
    expect(summary(observations.events)).toEqual([
      "0501 KR-1-1715 arrived",
      "0503 KR-1-P154 arrived",
      "0506 KR-1-P155 arrived",
      "0701 KR-1-P149 arrived",
      "0702 KR-1-0153 approaching",
      "4203 S1-4-423 arrived",
      "4204 S1-4-420 arrived",
      "4205 S1-4-418 approaching",
      "4690 S1-4-417 arrived",
      "4707 S1-4-420 arrived",
    ]);
  });

  it("returns the 혜화 countdown rows, and none for 성균관대", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const { countdownRows } = await service.observeApi();

    // Assert
    expect(countdownRows.map((row) => `${row.trainNo} ${row.platformId} ${row.remainingSec}`)).toEqual([
      "4674 S1-4-420 150",
      "4174 S1-4-420 390",
      "4331 S1-4-420 240",
      "4173 S1-4-420 960",
    ]);
  });
});

describe("SubwaySeoulService.observeTrainMap", () => {
  it("crawls lines 1 and 4 once each and stamps their events at covered stations with the Clock's time", async () => {
    // Arrange
    const { service, trainmapClient } = setup();

    // Act
    const observations = await service.observeTrainMap();

    // Assert
    expect([...trainmapClient.calls].sort()).toEqual(["1", "4"]);
    expect(summary(observations.events)).toEqual([
      "0493 KR-1-0153 departed",
      "0494 KR-1-P154 departed",
      "0496 KR-1-P155 approaching",
      "0691 KR-1-P150 arrived",
      "0692 KR-1-P152 arrived",
      "4203 S1-4-423 arrived",
      "4204 S1-4-420 departed",
      "4205 S1-4-418 arrived",
      "4690 S1-4-417 arrived",
      "4707 S1-4-420 departed",
    ]);
    expect(observations.events.every((e) => e.stateChangedAt === NOW)).toBe(true);
    expect(observations.countdownRows).toEqual([]);
  });
});

describe("SubwaySeoulService observes each upstream as its own source", () => {
  it("names the Seoul API and the train map as the sources of their ticks", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const sources = [(await service.observeApi()).source, (await service.observeTrainMap()).source];

    // Assert
    expect(sources).toEqual(["seoul-subway-api", "seoul-trainmap"]);
  });
});

describe("SubwaySeoulService keeps each call's answer when another call of its tick fails", () => {
  it("hands on line 1's train-map events when line 4's page does not parse, with that failure beside them", async () => {
    // Arrange
    const { service, trainmapClient } = setup();
    trainmapClient.pages.set("4", "<html>점검 중</html>");

    // Act
    const settled = await service.observeTrainMap();

    // Assert
    expect(summary(settled.events)).toEqual([
      "0493 KR-1-0153 departed",
      "0494 KR-1-P154 departed",
      "0496 KR-1-P155 approaching",
      "0691 KR-1-P150 arrived",
      "0692 KR-1-P152 arrived",
    ]);
    expect(settled.failures).toEqual([expect.objectContaining({ source: "seoul-trainmap", code: "unexpected_shape" })]);
  });

  it("rejects the train-map tick when neither line's page parses", async () => {
    // Arrange
    const { service, trainmapClient } = setup();
    trainmapClient.pages.set("1", "<html>점검 중</html>");
    trainmapClient.pages.set("4", "<html>점검 중</html>");

    // Act & Assert
    await expect(service.observeTrainMap()).rejects.toMatchObject({ source: "seoul-trainmap", code: "unexpected_shape" });
  });

  it("hands on both lines' API events when 혜화's arrivals call fails, with that failure beside them", async () => {
    // Arrange
    const { service, apiClient } = setup();
    const failure = new Error("realtimeStationArrival: HTTP 500");
    apiClient.arrivals.set("혜화", failure);

    // Act
    const settled = await service.observeApi();

    // Assert
    expect(settled.events).toHaveLength(10);
    expect(settled.countdownRows).toEqual([]);
    expect(settled.failures).toEqual([failure]);
  });

  it("hands on line 4's API events and 혜화's countdown rows when line 1's positions call fails", async () => {
    // Arrange
    const { service, apiClient } = setup();
    const failure = new Error("realtimePosition: HTTP 500");
    apiClient.positions.set("1호선", failure);

    // Act
    const settled = await service.observeApi();

    // Assert
    expect(summary(settled.events)).toEqual([
      "4203 S1-4-423 arrived",
      "4204 S1-4-420 arrived",
      "4205 S1-4-418 approaching",
      "4690 S1-4-417 arrived",
      "4707 S1-4-420 arrived",
    ]);
    expect(settled.countdownRows).toHaveLength(4);
    expect(settled.failures).toEqual([failure]);
  });

  it("rejects the API tick with its first failure when all 4 calls fail", async () => {
    // Arrange
    const { service, apiClient } = setup();
    const failures = ["1호선", "4호선", "성균관대", "혜화"].map((name) => new Error(`${name}: HTTP 500`));
    apiClient.positions.set("1호선", failures[0] as Error);
    apiClient.positions.set("4호선", failures[1] as Error);
    apiClient.arrivals.set("성균관대", failures[2] as Error);
    apiClient.arrivals.set("혜화", failures[3] as Error);

    // Act & Assert
    await expect(service.observeApi()).rejects.toBe(failures[0]);
  });
});
