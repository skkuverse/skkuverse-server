/**
 * GET /subway/stations/:stationId/arrivals through the real controller, the
 * arrivals service, the tracker and its run matcher, the timetable and
 * estimate doors and the committed weekday tables, with FakeSubwayRepository, FakeHolidaysRepository
 * and a scripted Clock. The tracker is fed one upstream's observations per
 * tick, as the pollers feed it. What it guards: a station is requested by its
 * slug, and the 200 body names it and holds one line entry per platform, with
 * the line's display data, the platform's KRIC id, its own generatedAt and one
 * entry per direction, as the wire publishes it; any other id, a KRIC platform
 * id included, is a 404 `SUBWAY_STATION_NOT_FOUND`; a served response
 * is `private, max-age=5`; a state older than 2 minutes serves every train
 * `scheduled`; a train whose departure was observed is not listed; a published
 * countdown arrives at its row time plus its seconds; a train seen at the
 * nearest upstream station is one stop away; 강남 serves its 2호선 line entry
 * with the circle directions and a published countdown live; 잠실 and 도곡
 * serve two line entries in platform order, 잠실's captured 8호선 rows giving
 * no countdown beside its live 2호선 ones; a 수인분당 train seen arrived, whose
 * departure no source reports, is listed until 90 s past its estimated
 * departure; every one of the eight stations answers with its platforms in
 * order, 정자's 신분당 line named in Korean; a 신분당 trainset seen leaving 광교
 * is served at 광교중앙 as the run it is matched to; and the station, direction
 * and neighbor station names follow the request language.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { HolidaysModule } from "../../../src/holidays/holidays.module";
import { HolidaysRepository } from "../../../src/holidays/holidays.repository";
import { Clock } from "../../../src/infra/clock";
import { SubwayArrivalsModule } from "../../../src/subway/arrivals/subway-arrivals.module";
import { subwayStationArrivals } from "../../../src/subway/arrivals/subway-arrivals.wire";
import { SubwayEstimateModule } from "../../../src/subway/estimate/subway-estimate.module";
import { SubwayMatchingModule } from "../../../src/subway/matching/subway-matching.module";
import { SubwayModule } from "../../../src/subway/subway.module";
import { SubwayRepository } from "../../../src/subway/subway.repository";
import type { CountdownRow, TrainEvent } from "../../../src/subway/subway.types";
import { SubwayTimetableModule } from "../../../src/subway/timetable/subway-timetable.module";
import { SubwayTrackingModule } from "../../../src/subway/tracking/subway-tracking.module";
import { SubwayTrackingService } from "../../../src/subway/tracking/subway-tracking.service";
import fs from "fs";
import path from "path";
import { toCountdownRows } from "../../../src/subway/seoul-api/subway-seoul-api.mapper";
import type { SeoulArrivalRow } from "../../../src/subway/seoul-api/subway-seoul-api.schema";
import { toSeoulStations } from "../../../src/subway/seoul/subway-seoul.rules";
import { SUBWAY_REGISTRY } from "../../../src/subway/subway.config";
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
    imports: [HolidaysModule, SubwayModule, SubwayTimetableModule, SubwayEstimateModule, SubwayTrackingModule, SubwayMatchingModule, SubwayArrivalsModule],
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

// WHY: the stations these tests read through it have one platform, so their one line entry holds every direction.
const directionsOf = (body: { data: { lines: Array<{ directions: any[] }> } }) => body.data.lines[0]!.directions;

function getAt(kst: string, url: string): request.Test {
  clock.current = at(kst);
  return request(httpServer).get(url);
}

describe("GET /subway/stations/:stationId/arrivals", () => {
  it("answers hyehwa with its 4호선 line entry and one entry per direction, as the wire publishes it", async () => {
    // Arrange
    await trackAt("20:41:00", "seoul-subway-api", []);

    // Act
    const res = await getAt("20:41:02", "/subway/stations/hyehwa/arrivals");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ lang: "ko" });
    expect(res.body.data.station).toEqual({ id: "hyehwa", name: "혜화" });
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.lines[0]).toMatchObject({
      line: { code: "4", name: "4호선", badge: "4", color: "00A5DE" },
      platformId: "S1-4-420",
      generatedAt: at("20:41:00").toISOString(),
    });
    expect(directionsOf(res.body).map((d: { direction: string; trains: unknown[] }) => [d.direction, d.trains.length])).toEqual([
      ["up", 3],
      ["down", 3],
    ]);
    expectWire(subwayStationArrivals, res.body.data);
  });

  it("answers sungkyunkwan with its 1호선 line entry, as the wire publishes it", async () => {
    // Act
    const res = await getAt("20:41:02", "/subway/stations/sungkyunkwan/arrivals");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.station).toEqual({ id: "sungkyunkwan", name: "성균관대" });
    expect(res.body.data.lines.map((l: { line: unknown; platformId: string }) => [l.line, l.platformId])).toEqual([
      [{ code: "1", name: "1호선", badge: "1", color: "0052A4" }, "KR-1-0153"],
    ]);
    expectWire(subwayStationArrivals, res.body.data);
  });

  it("answers gangnam with its 2호선 line entry first, its circle directions and its neighbors, as the wire publishes it", async () => {
    // Arrange
    await trackAt("20:41:00", "seoul-subway-api", []);

    // Act
    const res = await getAt("20:41:02", "/subway/stations/gangnam/arrivals");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.station).toEqual({ id: "gangnam", name: "강남" });
    expect(res.body.data.lines.map((l: { line: unknown; platformId: string }) => [l.line, l.platformId])).toEqual([
      [{ code: "2", name: "2호선", badge: "2", color: "00A84D" }, "S1-2-222"],
      [{ code: "D1", name: "신분당선", badge: "신분당", color: "D4003B" }, "DX-D1-4307"],
    ]);
    expect(directionsOf(res.body).map((d: { direction: string; name: string; previousStation: unknown; nextStation: unknown }) => [d.direction, d.name, d.previousStation, d.nextStation])).toEqual([
      ["up", "내선순환", { id: "S1-2-221", name: "역삼" }, { id: "S1-2-223", name: "교대" }],
      ["down", "외선순환", { id: "S1-2-223", name: "교대" }, { id: "S1-2-221", name: "역삼" }],
    ]);
    expectWire(subwayStationArrivals, res.body.data);
  });

  it("Live first: serves a 강남 2호선 countdown of 150 s generated at 20:40:20 as arriving at 20:42:50, live", async () => {
    // Arrange
    const row: CountdownRow = { trainNo: "2440", platformId: "S1-2-222", generatedAt: at("20:40:20"), remainingSec: 150 };
    await trackAt("20:41:00", "seoul-subway-api", [], [row]);

    // Act
    const res = await getAt("20:41:03", "/subway/stations/gangnam/arrivals");

    // Assert
    const up = directionsOf(res.body).find((d: { direction: string }) => d.direction === "up");
    expect(up.trains.find((t: { trainNo: string }) => t.trainNo === "2440")).toMatchObject({ arrivalAt: at("20:42:50").toISOString(), source: "live" });
  });

  it("answers jamsil with its 2호선 then its 8호선 line entry, and dogok with 3호선 then 수인분당선, as the wire publishes them", async () => {
    // Act
    const jamsil = await getAt("20:41:02", "/subway/stations/jamsil/arrivals");
    const dogok = await getAt("20:41:02", "/subway/stations/dogok/arrivals");

    // Assert
    const entriesOf = (body: { data: { lines: Array<{ line: { code: string; badge: string; color: string }; platformId: string }> } }) =>
      body.data.lines.map((l) => [l.line.code, l.line.badge, l.line.color, l.platformId]);
    expect(entriesOf(jamsil.body)).toEqual([
      ["2", "2", "00A84D", "S1-2-216"],
      ["8", "8", "E6186C", "S1-8-2815"],
    ]);
    expect(entriesOf(dogok.body)).toEqual([
      ["3", "3", "EF7C1C", "S1-3-334"],
      ["K1", "수인분당", "F5A200", "KR-K1-K217"],
    ]);
    expect(dogok.body.data.lines[1].directions.map((d: { name: string }) => d.name)).toEqual(["청량리 방면", "인천 방면"]);
    expectWire(subwayStationArrivals, jamsil.body.data);
    expectWire(subwayStationArrivals, dogok.body.data);
  });

  it.each([
    ["sungkyunkwan", ["KR-1-0153"]],
    ["hyehwa", ["S1-4-420"]],
    ["jeongja", ["DX-D1-4312", "KR-K1-K230"]],
    ["jamsil", ["S1-2-216", "S1-8-2815"]],
    ["dogok", ["S1-3-334", "KR-K1-K217"]],
    ["gangnam", ["S1-2-222", "DX-D1-4307"]],
    ["yangjae", ["S1-3-332", "DX-D1-4308"]],
    ["gwanggyo-jungang", ["DX-D1-4318"]],
  ])("Every station answers: %s with its platforms' line entries %j in order, each with both directions, as the wire publishes it", async (stationId, platformIds) => {
    // Arrange
    await trackAt("20:41:00", "seoul-subway-api", []);

    // Act
    const res = await getAt("20:41:02", `/subway/stations/${stationId}/arrivals`);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.station.id).toBe(stationId);
    expect(res.body.data.lines.map((l: { platformId: string }) => l.platformId)).toEqual(platformIds);
    expect(res.body.data.lines.map((l: { directions: Array<{ direction: string }> }) => l.directions.map((d) => d.direction))).toEqual(platformIds.map(() => ["up", "down"]));
    expectWire(subwayStationArrivals, res.body.data);
  });

  it("Named line in Korean: serves jeongja's 신분당 entry as D1, 신분당선, badge 신분당, color D4003B, before its 수인분당 entry", async () => {
    // Act
    const res = await getAt("20:41:02", "/subway/stations/jeongja/arrivals").set("Accept-Language", "ko");

    // Assert
    expect(res.body.data.station).toEqual({ id: "jeongja", name: "정자" });
    expect(res.body.data.lines.map((l: { line: unknown }) => l.line)).toEqual([
      { code: "D1", name: "신분당선", badge: "신분당", color: "D4003B" },
      { code: "K1", name: "수인분당선", badge: "수인분당", color: "F5A200" },
    ]);
    expect(res.body.data.lines[0].directions.map((d: { name: string }) => d.name)).toEqual(["신사 방면", "광교 방면"]);
  });

  it("serves trainset 20, seen leaving 광교 for 신사 70 s late, as its matched run 1286 at 광교중앙, estimated and one stop away", async () => {
    // Arrange
    const leaving: TrainEvent = { ...event("20", "DX-D1-4319", "departed", "20:41:10", "신사"), reportedDirection: "down" };
    await trackAt("20:41:15", "seoul-subway-api", [leaving]);

    // Act
    const res = await getAt("20:41:17", "/subway/stations/gwanggyo-jungang/arrivals");

    // Assert
    const up = directionsOf(res.body).find((d: { direction: string }) => d.direction === "up");
    const train = up.trains.find((t: { trainNo: string }) => t.trainNo === "1286");
    expect(train).toMatchObject({ destination: "신사", arrivalAt: at("20:44:10").toISOString(), stopsAway: 1, source: "estimated" });
    expect(up.trains.map((t: { trainNo: string }) => t.trainNo)).not.toContain("20");
  });

  it("Line without countdowns: serves 잠실's captured 2호선 countdowns live and none of its 8호선 trains live, whose rows carry none", async () => {
    // Arrange
    const fetchedAt = new Date("2026-10-17T21:07:00+09:00");
    const captured = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/realtime-arrival-jamsil.json"), "utf8")) as { realtimeArrivalList: SeoulArrivalRow[] };
    const jamsil = toSeoulStations(SUBWAY_REGISTRY).find((station) => station.seoulName === "잠실");
    const countdownRows = toCountdownRows(captured.realtimeArrivalList, jamsil?.platformBySubwayId ?? new Map(), fetchedAt);
    clock.current = fetchedAt;
    await app.get(SubwayTrackingService).track({ observe: async () => ({ source: "seoul-subway-api", events: [], countdownRows }) });

    // Act
    clock.current = new Date("2026-10-17T21:07:02+09:00");
    const res = await request(httpServer).get("/subway/stations/jamsil/arrivals");

    // Assert
    const sourcesOf = (index: number): string[] =>
      res.body.data.lines[index].directions.flatMap((d: { trains: Array<{ source: string }> }) => d.trains.map((t) => t.source));
    expect(res.body.data.lines.map((l: { platformId: string }) => l.platformId)).toEqual(["S1-2-216", "S1-8-2815"]);
    expect(sourcesOf(0)).toContain("live");
    expect(sourcesOf(1).length).toBeGreaterThan(0);
    expect(sourcesOf(1).every((source) => source === "estimated" || source === "scheduled")).toBe(true);
  });

  it.each([
    ["89 s", "20:44:19", true],
    ["91 s", "20:44:21", false],
  ])("Departure never reported: lists 수인분당 6204, seen arrived at 정자 20 s late, until 90 s past its estimated departure (%s past: %s)", async (_label, kst, listed) => {
    // Arrange
    await trackAt("20:42:25", "seoul-subway-api", [event("6204", "KR-K1-K230", "arrived", "20:42:20", "왕십리")]);
    await trackAt(kst, "seoul-subway-api", []);

    // Act
    const res = await getAt(kst, "/subway/stations/jeongja/arrivals");

    // Assert
    const up = res.body.data.lines.find((l: { platformId: string }) => l.platformId === "KR-K1-K230").directions[0];
    const train = up.trains.find((t: { trainNo: string }) => t.trainNo === "6204");
    expect(train !== undefined).toBe(listed);
    if (listed) expect(train).toMatchObject({ arrivalAt: at("20:42:20").toISOString(), stopsAway: 0, source: "estimated" });
  });

  it.each(["S1-4-420", "KR-1-0153", "S1-2-222", "seoul", "Hyehwa"])("answers %s with 404 SUBWAY_STATION_NOT_FOUND and no cache header", async (stationId) => {
    // Act
    const res = await getAt("20:41:02", `/subway/stations/${stationId}/arrivals`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "SUBWAY_STATION_NOT_FOUND", message: expect.any(String) } });
    expect(res.headers["cache-control"]).not.toBe("private, max-age=5");
  });

  it.each(["sungkyunkwan", "hyehwa", "jeongja", "jamsil", "dogok", "gangnam", "yangjae", "gwanggyo-jungang"])("sends %s's arrivals with Cache-Control: private, max-age=5", async (stationId) => {
    // Act
    const res = await getAt("20:41:02", `/subway/stations/${stationId}/arrivals`);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=5");
  });

  it("serves every train scheduled once the state is over 2 minutes old", async () => {
    // Arrange
    await trackAt("20:39:10", "seoul-subway-api", [event("0493", "KR-1-P152", "arrived", "20:39:00", "서동탄")]);
    const fresh = await getAt("20:41:10", "/subway/stations/sungkyunkwan/arrivals");

    // Act
    const stale = await getAt("20:41:11", "/subway/stations/sungkyunkwan/arrivals");

    // Assert
    const sources = (body: typeof fresh.body) => directionsOf(body).flatMap((d: { trains: { source: string }[] }) => d.trains.map((t) => t.source));
    expect(sources(fresh.body)).toContain("estimated");
    expect(sources(stale.body)).toEqual(Array(6).fill("scheduled"));
    expect(stale.body.data.lines[0].generatedAt).toBe(at("20:41:11").toISOString());
  });

  it("no longer lists 0493 at 성균관대 once the train map shows it departed, the API still saying arrived", async () => {
    // Arrange
    const stuck = event("0493", "KR-1-0153", "arrived", "20:41:05", "서동탄");
    await trackAt("20:41:10", "seoul-subway-api", [stuck]);
    await trackAt("20:41:40", "seoul-trainmap", [event("0493", "KR-1-0153", "departed", "20:41:40", "서동탄")]);
    await trackAt("20:41:50", "seoul-subway-api", [stuck]);

    // Act
    const res = await getAt("20:41:52", "/subway/stations/sungkyunkwan/arrivals");

    // Assert
    expect(res.status).toBe(200);
    const down = directionsOf(res.body).find((d: { direction: string }) => d.direction === "down");
    expect(down.trains.map((t: { trainNo: string }) => t.trainNo)).not.toContain("0493");
  });

  it("serves a 혜화 countdown of 150 s generated at 20:40:20 as arriving at 20:42:50, live, with no seconds left of its own", async () => {
    // Arrange
    const row: CountdownRow = { trainNo: "4674", platformId: "S1-4-420", generatedAt: at("20:40:20"), remainingSec: 150 };
    await trackAt("20:41:00", "seoul-subway-api", [], [row]);

    // Act
    const res = await getAt("20:41:03", "/subway/stations/hyehwa/arrivals");

    // Assert
    const up = directionsOf(res.body).find((d: { direction: string }) => d.direction === "up");
    expect(res.body.data.lines[0].generatedAt).toBe(at("20:41:00").toISOString());
    const train = up.trains.find((t: { trainNo: string }) => t.trainNo === "4674");
    expect(train).toMatchObject({ arrivalAt: at("20:42:50").toISOString(), source: "live" });
    expect(train).not.toHaveProperty("remainingSec");
  });

  it("counts 0691, arrived at 의왕 (KR-1-P152), one stop away from 성균관대 down", async () => {
    // Arrange
    await trackAt("20:47:40", "seoul-subway-api", [event("0691", "KR-1-P152", "arrived", "20:47:30", "천안")]);

    // Act
    const res = await getAt("20:47:42", "/subway/stations/sungkyunkwan/arrivals");

    // Assert
    expect(res.status).toBe(200);
    const down = directionsOf(res.body).find((d: { direction: string }) => d.direction === "down");
    const train = down.trains.find((t: { trainNo: string }) => t.trainNo === "0691");
    expect(train).toMatchObject({ stopsAway: 1, source: "estimated" });
    expect(train).not.toHaveProperty("position");
  });

  it.each([
    ["en-US", "en", "Sungkyunkwan Univ.", "Line 1", ["Toward Seoul", "Toward Cheonan / Seodongtan"]],
    ["zh-CN", "zh", "成均馆大学", "1号线", ["首尔方向", "天安·西东滩方向"]],
    ["ko-KR", "ko", "성균관대", "1호선", ["서울 방면", "천안·서동탄 방면"]],
  ])("labels the station, its line and its directions for Accept-Language %s", async (acceptLanguage, lang, stationName, lineName, directionNames) => {
    // Act
    const res = await getAt("20:41:02", "/subway/stations/sungkyunkwan/arrivals").set("Accept-Language", acceptLanguage);

    // Assert
    expect(res.body.meta).toEqual({ lang });
    expect(res.body.data.station.name).toBe(stationName);
    expect(res.body.data.lines[0].line.name).toBe(lineName);
    expect(directionsOf(res.body).map((d: { name: string }) => d.name)).toEqual(directionNames);
  });

  it.each([
    ["ko-KR", [{ id: "KR-1-P154", name: "화서" }, { id: "KR-1-P152", name: "의왕" }], [{ id: "KR-1-P152", name: "의왕" }, { id: "KR-1-P154", name: "화서" }]],
    ["en-US", [{ id: "KR-1-P154", name: "Hwaseo" }, { id: "KR-1-P152", name: "Uiwang" }], [{ id: "KR-1-P152", name: "Uiwang" }, { id: "KR-1-P154", name: "Hwaseo" }]],
    ["zh-CN", [{ id: "KR-1-P154", name: "华西" }, { id: "KR-1-P152", name: "义王" }], [{ id: "KR-1-P152", name: "义王" }, { id: "KR-1-P154", name: "华西" }]],
  ])("names each 성균관대 direction's previous and next stations for Accept-Language %s", async (acceptLanguage, up, down) => {
    // Act
    const res = await getAt("20:41:02", "/subway/stations/sungkyunkwan/arrivals").set("Accept-Language", acceptLanguage);

    // Assert
    expect(res.status).toBe(200);
    const neighbors = directionsOf(res.body).map((d: { previousStation: unknown; nextStation: unknown }) => [d.previousStation, d.nextStation]);
    expect(neighbors).toEqual([up, down]);
  });
});
