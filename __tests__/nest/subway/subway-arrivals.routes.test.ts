/**
 * GET /subway/stations/:stationId/arrivals through the real controller, the
 * arrivals service, the tracker, the timetable and estimate doors and the
 * committed weekday tables, with FakeSubwayRepository, FakeHolidaysRepository
 * and a scripted Clock. The tracker is fed one upstream's observations per
 * tick, as the pollers feed it. What it guards: the 200 body names the
 * station's KRIC codes and one entry per direction, as the wire publishes it;
 * any other station id is a 404 `SUBWAY_STATION_NOT_FOUND`; a served response
 * is `private, max-age=5`; a state older than 2 minutes serves every train
 * `scheduled`; a train whose departure was observed is not listed; a published
 * countdown arrives at its row time plus its seconds; a train seen at the
 * nearest upstream station is one stop away; and the station, direction and
 * neighbor station names follow the request language.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { HolidaysModule } from "../../../src/holidays/holidays.module";
import { HolidaysRepository } from "../../../src/holidays/holidays.repository";
import { Clock } from "../../../src/infra/clock";
import { SubwayArrivalsModule } from "../../../src/subway/arrivals/subway-arrivals.module";
import { subwayStationArrivals } from "../../../src/subway/arrivals/subway-arrivals.wire";
import { SubwayEstimateModule } from "../../../src/subway/estimate/subway-estimate.module";
import { SubwayModule } from "../../../src/subway/subway.module";
import { SubwayRepository } from "../../../src/subway/subway.repository";
import type { CountdownRow, TrainEvent } from "../../../src/subway/subway.types";
import { SubwayTimetableModule } from "../../../src/subway/timetable/subway-timetable.module";
import { SubwayTrackingModule } from "../../../src/subway/tracking/subway-tracking.module";
import { SubwayTrackingService } from "../../../src/subway/tracking/subway-tracking.service";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeHolidaysRepository } from "../../helpers/fakes/holidays/holidays.repository.fake";
import { FakeSubwayRepository } from "../../helpers/fakes/subway/subway.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const at = (kst: string): Date => new Date(`2026-10-16T${kst}+09:00`);
const clock = { current: at("20:41:00"), now(): Date { return this.current; } };

let app: NestExpressApplication;
let httpServer: import("http").Server;
let subwayRepository: FakeSubwayRepository;

beforeAll(async () => {
  subwayRepository = new FakeSubwayRepository();
  app = await buildTestApp({
    imports: [HolidaysModule, SubwayModule, SubwayTimetableModule, SubwayEstimateModule, SubwayTrackingModule, SubwayArrivalsModule],
    overrides: [
      { provide: HolidaysRepository, useValue: new FakeHolidaysRepository() },
      { provide: SubwayRepository, useValue: subwayRepository },
      { provide: Clock, useValue: clock },
    ],
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  subwayRepository.docs.clear();
});

async function trackAt(kst: string, source: string, events: TrainEvent[], countdownRows: CountdownRow[] = []): Promise<void> {
  clock.current = at(kst);
  await app.get(SubwayTrackingService).track({ observe: async () => ({ source, events, countdownRows }) });
}

function event(trainNo: string, platformId: string, state: TrainEvent["state"], kst: string, destination: string): TrainEvent {
  return { trainNo, platformId, state, stateChangedAt: at(kst), destination };
}

function getAt(kst: string, path: string): request.Test {
  clock.current = at(kst);
  return request(httpServer).get(path);
}

describe("GET /subway/stations/:stationId/arrivals", () => {
  it("answers 혜화 with its KRIC codes and one entry per direction, as the wire publishes it", async () => {
    // Arrange
    await trackAt("20:41:00", "seoul-subway-api", []);

    // Act
    const res = await getAt("20:41:02", "/subway/stations/S1-4-420/arrivals");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ lang: "ko" });
    expect(res.body.data.station).toEqual({ id: "S1-4-420", operatorCode: "S1", lineCode: "4", stationCode: "420", name: "혜화" });
    expect(res.body.data.directions.map((d: { direction: string; trains: unknown[] }) => [d.direction, d.trains.length])).toEqual([
      ["up", 3],
      ["down", 3],
    ]);
    expectWire(subwayStationArrivals, res.body.data);
  });

  it.each(["S1-2-222", "KR-1-P154", "hyehwa"])("answers %s with 404 SUBWAY_STATION_NOT_FOUND and no cache header", async (stationId) => {
    // Act
    const res = await getAt("20:41:02", `/subway/stations/${stationId}/arrivals`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "SUBWAY_STATION_NOT_FOUND", message: expect.any(String) } });
    expect(res.headers["cache-control"]).not.toBe("private, max-age=5");
  });

  it.each(["KR-1-0153", "S1-4-420"])("sends %s's arrivals with Cache-Control: private, max-age=5", async (stationId) => {
    // Act
    const res = await getAt("20:41:02", `/subway/stations/${stationId}/arrivals`);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=5");
  });

  it("serves every train scheduled once the state is over 2 minutes old", async () => {
    // Arrange
    await trackAt("20:39:10", "seoul-subway-api", [event("0493", "KR-1-P152", "arrived", "20:39:00", "서동탄")]);
    const fresh = await getAt("20:41:10", "/subway/stations/KR-1-0153/arrivals");

    // Act
    const stale = await getAt("20:41:11", "/subway/stations/KR-1-0153/arrivals");

    // Assert
    const sources = (body: typeof fresh.body) => body.data.directions.flatMap((d: { trains: { source: string }[] }) => d.trains.map((t) => t.source));
    expect(sources(fresh.body)).toContain("estimated");
    expect(sources(stale.body)).toEqual(Array(6).fill("scheduled"));
    expect(stale.body.data.generatedAt).toBe(at("20:41:11").toISOString());
  });

  it("no longer lists 0493 at 성균관대 once the train map shows it departed, the API still saying arrived", async () => {
    // Arrange
    const stuck = event("0493", "KR-1-0153", "arrived", "20:41:05", "서동탄");
    await trackAt("20:41:10", "seoul-subway-api", [stuck]);
    await trackAt("20:41:40", "seoul-trainmap", [event("0493", "KR-1-0153", "departed", "20:41:40", "서동탄")]);
    await trackAt("20:41:50", "seoul-subway-api", [stuck]);

    // Act
    const res = await getAt("20:41:52", "/subway/stations/KR-1-0153/arrivals");

    // Assert
    expect(res.status).toBe(200);
    const down = res.body.data.directions.find((d: { direction: string }) => d.direction === "down");
    expect(down.trains.map((t: { trainNo: string }) => t.trainNo)).not.toContain("0493");
  });

  it("serves a 혜화 countdown of 150 s generated at 20:40:20 as arriving at 20:42:50, live, with no seconds left of its own", async () => {
    // Arrange
    const row: CountdownRow = { trainNo: "4674", platformId: "S1-4-420", generatedAt: at("20:40:20"), remainingSec: 150 };
    await trackAt("20:41:00", "seoul-subway-api", [], [row]);

    // Act
    const res = await getAt("20:41:03", "/subway/stations/S1-4-420/arrivals");

    // Assert
    const up = res.body.data.directions.find((d: { direction: string }) => d.direction === "up");
    expect(res.body.data.generatedAt).toBe(at("20:41:00").toISOString());
    const train = up.trains.find((t: { trainNo: string }) => t.trainNo === "4674");
    expect(train).toMatchObject({ arrivalAt: at("20:42:50").toISOString(), source: "live" });
    expect(train).not.toHaveProperty("remainingSec");
  });

  it("counts 0691, arrived at 의왕 (KR-1-P152), one stop away from 성균관대 down", async () => {
    // Arrange
    await trackAt("20:47:40", "seoul-subway-api", [event("0691", "KR-1-P152", "arrived", "20:47:30", "천안")]);

    // Act
    const res = await getAt("20:47:42", "/subway/stations/KR-1-0153/arrivals");

    // Assert
    expect(res.status).toBe(200);
    const down = res.body.data.directions.find((d: { direction: string }) => d.direction === "down");
    const train = down.trains.find((t: { trainNo: string }) => t.trainNo === "0691");
    expect(train).toMatchObject({ stopsAway: 1, source: "estimated" });
    expect(train).not.toHaveProperty("position");
  });

  it.each([
    ["en-US", "en", "Sungkyunkwan Univ.", ["Toward Seoul", "Toward Cheonan / Seodongtan"]],
    ["zh-CN", "zh", "成均馆大学", ["首尔方向", "天安·西东滩方向"]],
    ["ko-KR", "ko", "성균관대", ["서울 방면", "천안·서동탄 방면"]],
  ])("labels the station and its directions for Accept-Language %s", async (acceptLanguage, lang, stationName, directionNames) => {
    // Act
    const res = await getAt("20:41:02", "/subway/stations/KR-1-0153/arrivals").set("Accept-Language", acceptLanguage);

    // Assert
    expect(res.body.meta).toEqual({ lang });
    expect(res.body.data.station.name).toBe(stationName);
    expect(res.body.data.directions.map((d: { name: string }) => d.name)).toEqual(directionNames);
  });

  it.each([
    ["ko-KR", [{ id: "KR-1-P154", name: "화서" }, { id: "KR-1-P152", name: "의왕" }], [{ id: "KR-1-P152", name: "의왕" }, { id: "KR-1-P154", name: "화서" }]],
    ["en-US", [{ id: "KR-1-P154", name: "Hwaseo" }, { id: "KR-1-P152", name: "Uiwang" }], [{ id: "KR-1-P152", name: "Uiwang" }, { id: "KR-1-P154", name: "Hwaseo" }]],
    ["zh-CN", [{ id: "KR-1-P154", name: "华西" }, { id: "KR-1-P152", name: "义王" }], [{ id: "KR-1-P152", name: "义王" }, { id: "KR-1-P154", name: "华西" }]],
  ])("names each 성균관대 direction's previous and next stations for Accept-Language %s", async (acceptLanguage, up, down) => {
    // Act
    const res = await getAt("20:41:02", "/subway/stations/KR-1-0153/arrivals").set("Accept-Language", acceptLanguage);

    // Assert
    expect(res.status).toBe(200);
    const neighbors = res.body.data.directions.map((d: { previousStation: unknown; nextStation: unknown }) => [d.previousStation, d.nextStation]);
    expect(neighbors).toEqual([up, down]);
  });
});
