/**
 * GET /subway/stations/:stationId/arrivals while an upstream fails, end to end
 * on fakes: the real `seoul` provider and its pollers (registered into a
 * recording stand-in for the poller registry), the tracker, the timetable and
 * estimate doors and the arrivals route, over FakeSubwaySeoulApiClient,
 * the stored topology's revision 1 in FakeSubwayTopologyRepository, the
 * trimmed fixture of revision 1 in FakeSubwayTimetableRepository,
 * FakeSubwaySeoulTrainmapClient (the line 1 and 4 positions and the line 4
 * page captured on 2026-10-16 22:27 KST, joined with the line 1 page as the one
 * page of every line the crawl reads; the line 1 page dates from 20:45, so
 * its trains are too far from their timetable rows to count), FakeSubwayRepository, FakeCalendarRepository and a
 * scripted Clock. Each test is a scenario of "Serving survives a failing
 * source": a train map that cannot be parsed fails its own
 * job while the API's arrivals keep being served; a failing API leaves the
 * train map's arrivals served; and with neither upstream answering for 3
 * minutes every listed train is `scheduled`.
 */
import fs from "fs";
import path from "path";
import { Global, Module } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { CalendarModule } from "../../../src/calendar/calendar.module";
import { CalendarRepository } from "../../../src/calendar/calendar.repository";
import { Clock } from "../../../src/infra/clock";
import { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";
import { SubwayArrivalsModule } from "../../../src/subway/arrivals/subway-arrivals.module";
import { SubwayEstimateModule } from "../../../src/subway/estimate/subway-estimate.module";
import { SubwayMatchingModule } from "../../../src/subway/matching/subway-matching.module";
import { SubwaySeoulApiClient } from "../../../src/subway/seoul-api/subway-seoul-api.client";
import { SubwaySeoulApiModule } from "../../../src/subway/seoul-api/subway-seoul-api.module";
import { SubwaySeoulTrainmapClient } from "../../../src/subway/seoul-trainmap/subway-seoul-trainmap.client";
import { SubwaySeoulTrainmapModule } from "../../../src/subway/seoul-trainmap/subway-seoul-trainmap.module";
import { SubwaySeoulModule } from "../../../src/subway/seoul/subway-seoul.module";
import { SUBWAY_LINES, SUBWAY_STATIONS } from "../../../src/subway/subway.constants";
import { SubwayModule } from "../../../src/subway/subway.module";
import { SubwayRepository } from "../../../src/subway/subway.repository";
import { SubwayTimetableModule } from "../../../src/subway/timetable/subway-timetable.module";
import { SubwayTimetableRepository } from "../../../src/subway/timetable/subway-timetable.repository";
import { SubwayTopologyRepository } from "../../../src/subway/topology/subway-topology.repository";
import { SubwayStationCoordsRepository } from "../../../src/subway/station-coords/subway-station-coords.repository";
import { storedStationCoordsRepository } from "../../helpers/subway/station-coords";
import { SubwayTrackingModule } from "../../../src/subway/tracking/subway-tracking.module";
import { FakeCalendarRepository } from "../../helpers/fakes/calendar/calendar.repository.fake";
import { FakeSubwaySeoulApiClient } from "../../helpers/fakes/subway/subway-seoul-api.client.fake";
import { FakeSubwaySeoulTrainmapClient } from "../../helpers/fakes/subway/subway-seoul-trainmap.client.fake";
import { FakeSubwayRepository } from "../../helpers/fakes/subway/subway.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { storedSubwayTopologyRepository } from "../../helpers/subway/topology";
import { storedSubwayTimetableRepository } from "../../helpers/subway/timetables";

type Tick = () => Promise<unknown>;

const FIXTURES = path.join(__dirname, "fixtures");
const rows = <T>(name: string, list: string): T[] => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"))[list];
const page = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf8");

// WHY: the train map is one page for every line, requested as line 0.
const ALL_LINES = "0";
const at = (kst: string): Date => new Date(`2026-10-16T${kst}+09:00`);
const clock = { current: at("22:27:30"), now(): Date { return this.current; } };
const ticks = new Map<string, Tick>();
const registry = { registerPoller: (fn: Tick, _intervalMs: number, name: string): void => void ticks.set(name, fn) };

// Stands in for the @Global SchedulingModule, which provides the registry in main.ts; it records each tick by name.
@Global()
@Module({ providers: [{ provide: PollerRegistryService, useValue: registry }], exports: [PollerRegistryService] })
class SchedulingStubModule {}

let app: NestExpressApplication;
let httpServer: import("http").Server;
let apiClient: FakeSubwaySeoulApiClient;
let trainmapClient: FakeSubwaySeoulTrainmapClient;

// A fresh app per test: the tracker keeps its train histories in memory, so no test inherits another's.
beforeEach(async () => {
  ticks.clear();
  apiClient = new FakeSubwaySeoulApiClient();
  trainmapClient = new FakeSubwaySeoulTrainmapClient();
  answerApi();
  answerTrainMap();
  app = await buildTestApp({
    imports: [
      SchedulingStubModule,
      CalendarModule,
      SubwayModule,
      SubwayTimetableModule,
      SubwayEstimateModule,
      SubwaySeoulApiModule,
      SubwaySeoulTrainmapModule,
      SubwayTrackingModule,
      SubwayMatchingModule,
      SubwaySeoulModule,
      SubwayArrivalsModule,
    ],
    overrides: [
      { provide: CalendarRepository, useValue: new FakeCalendarRepository() },
      { provide: SubwayRepository, useValue: new FakeSubwayRepository() },
      { provide: SubwayTopologyRepository, useValue: storedSubwayTopologyRepository() },
      { provide: SubwayStationCoordsRepository, useValue: storedStationCoordsRepository() },
      { provide: SubwayTimetableRepository, useValue: storedSubwayTimetableRepository() },
      { provide: SubwaySeoulApiClient, useValue: apiClient },
      { provide: SubwaySeoulTrainmapClient, useValue: trainmapClient },
      { provide: Clock, useValue: clock },
    ],
  });
  httpServer = app.getHttpServer();
});

afterEach(async () => {
  await app.close();
});

function answerApi(): void {
  apiClient.positions.set("1호선", rows("realtime-position-line1.json", "realtimePositionList"));
  apiClient.positions.set("4호선", rows("realtime-position-line4.json", "realtimePositionList"));
  apiClient.arrivals.clear();
}

// WHY: every call of the tick, one per registered line and station: a tick whose arrivals calls still answer is
// tracked (subway-seoul.service.spec.ts).
function failApi(): void {
  const outage = new Error("seoul-subway-api: HTTP 503");
  for (const line of SUBWAY_LINES) apiClient.positions.set(line.seoul.lineName, outage);
  for (const station of SUBWAY_STATIONS) apiClient.arrivals.set(station.seoulName, outage);
}

function answerTrainMap(): void {
  trainmapClient.pages.set(ALL_LINES, `${page("trainmap-line1.html")}${page("trainmap-line4.html")}`);
}

function breakTrainMap(): void {
  trainmapClient.pages.set(ALL_LINES, "<html><body>시스템 점검 중입니다</body></html>");
}

function tickAt(kst: string, name: "subway-seoul" | "subway-trainmap"): Promise<unknown> {
  clock.current = at(kst);
  const tick = ticks.get(name);
  if (!tick) throw new Error(`${name} was not registered`);
  return tick();
}

function getAt(kst: string, stationId: string): request.Test {
  clock.current = at(kst);
  return request(httpServer).get(`/subway/stations/${stationId}/arrivals`);
}

type WireTrain = { trainNo: string; source: string; stopsAway: number | null };
const trainsOf = (body: { data: { lines: { directions: { trains: WireTrain[] }[] }[] } }): WireTrain[] =>
  body.data.lines.flatMap((line) => line.directions.flatMap((d) => d.trains));

describe("Serving survives a failing source", () => {
  it("Crawl breaks: responses keep succeeding with API-based arrivals, and the crawl job reports failing", async () => {
    // Arrange
    breakTrainMap();

    // Act
    const crawl = tickAt("22:27:30", "subway-trainmap");
    await expect(crawl).rejects.toMatchObject({ source: "seoul-trainmap" });
    await tickAt("22:27:31", "subway-seoul");
    const res = await getAt("22:27:33", "sungkyunkwan");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.lines[0].generatedAt).toBe(at("22:27:31").toISOString());
    const observed = trainsOf(res.body).filter((train) => train.source === "estimated" && train.stopsAway !== null);
    expect(observed.length).toBeGreaterThan(0);
  });

  it("API fails: arrivals are served from the train map and the timetable, and the API job reports failing", async () => {
    // Arrange
    failApi();

    // Act
    await expect(tickAt("22:27:30", "subway-seoul")).rejects.toThrow("seoul-subway-api: HTTP 503");
    await tickAt("22:27:31", "subway-trainmap");
    const res = await getAt("22:27:33", "hyehwa");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.lines[0].generatedAt).toBe(at("22:27:31").toISOString());
    const observed = trainsOf(res.body).filter((train) => train.source === "estimated" && train.stopsAway !== null);
    expect(observed.length).toBeGreaterThan(0);
  });

  it("Both down: with neither upstream answering for 3 minutes, every listed train has source scheduled", async () => {
    // Arrange
    await tickAt("22:27:30", "subway-seoul");
    await tickAt("22:27:31", "subway-trainmap");
    failApi();
    breakTrainMap();
    const outcomes: unknown[] = [];
    for (let second = 10; second <= 180; second += 10) {
      const upstream = second % 20 === 0 ? "subway-trainmap" : "subway-seoul";
      outcomes.push(await tickAt(toKst(at("22:27:31"), second), upstream).catch((err: unknown) => err));
    }
    const oneMinuteIn = await getAt("22:28:31", "hyehwa");

    // Act
    const threeMinutesIn = await getAt("22:30:31", "hyehwa");

    // Assert
    expect(outcomes.every((outcome) => outcome instanceof Error)).toBe(true);
    expect(trainsOf(oneMinuteIn.body).some((train) => train.source !== "scheduled")).toBe(true);
    expect(threeMinutesIn.status).toBe(200);
    const trains = trainsOf(threeMinutesIn.body);
    expect(trains.length).toBeGreaterThan(0);
    expect(trains.every((train) => train.source === "scheduled" && train.stopsAway === null)).toBe(true);
  });
});

function toKst(start: Date, plusSec: number): string {
  return new Date(start.getTime() + plusSec * 1000 + 9 * 3_600_000).toISOString().slice(11, 19);
}
