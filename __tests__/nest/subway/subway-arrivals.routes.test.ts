/**
 * GET /subway/stations/:stationId/arrivals through the real controller, the
 * arrivals service, the tracker and its run matcher, the timetable and
 * estimate doors and the trimmed fixture of revision 1 stored in FakeSubwayTimetableRepository, with FakeSubwayRepository, FakeCalendarRepository,
 * the stored topology's revision 1 in FakeSubwayTopologyRepository
 * and a scripted Clock. The tracker is fed one upstream's observations per
 * tick, as the pollers feed it. What it guards: a station is requested by its
 * slug, and the 200 body names it and holds one line entry per platform, with
 * the line's display data, the platform's KRIC id, its own generatedAt at +09:00 and one
 * entry per direction, each train ADR 0022's call, as the wire publishes it; any other id, a KRIC platform
 * id included, is a 404 `SUBWAY_STATION_NOT_FOUND`; a served response
 * is `private, max-age=5`; a state older than 2 minutes serves every train
 * on the `timetable` basis; a train whose departure was observed is not listed; a published
 * countdown is expected at its row time plus its seconds, on the `provider` basis; a train seen at the
 * nearest upstream station is one stop away; 강남 serves its 2호선 line entry
 * with the circle directions and a published countdown live; 잠실 and 도곡
 * serve two line entries in platform order, 잠실's captured 8호선 rows giving
 * no countdown beside its live 2호선 ones; a 수인분당 train seen arrived, whose
 * departure no source reports, is listed until 90 s past its estimated
 * departure; every one of the eight stations answers with its platforms in
 * order, 정자's 신분당 line named in Korean; each station carries its camera
 * point from the stored `subway-station-coords`, and a station the stored
 * coords lack still answers 200, its `coords` null, as the wire publishes it; a 신분당 trainset seen leaving 광교
 * is served at 광교중앙 as the run it is matched to; the station, direction
 * and neighbor station names follow the request language; each train says
 * whether it is the first its direction runs through the station on the
 * service day, 혜화's at 05:30 and none at 20:41; and `meta.serverNow` is the
 * clock at +09:00, as the wire publishes it.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { CalendarModule } from "../../../src/calendar/calendar.module";
import { CalendarRepository } from "../../../src/calendar/calendar.repository";
import { Clock } from "../../../src/infra/clock";
import { SubwayArrivalsModule } from "../../../src/subway/arrivals/subway-arrivals.module";
import { subwayStationArrivals, subwayStationArrivalsMeta } from "../../../src/subway/arrivals/subway-arrivals.wire";
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
import { SubwayTimetableRepository } from "../../../src/subway/timetable/subway-timetable.repository";
import { SubwayTopologyRepository } from "../../../src/subway/topology/subway-topology.repository";
import { SubwayStationCoordsRepository } from "../../../src/subway/station-coords/subway-station-coords.repository";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeCalendarRepository } from "../../helpers/fakes/calendar/calendar.repository.fake";
import { FakeSubwayRepository } from "../../helpers/fakes/subway/subway.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { storedSubwayTopologyRepository, subwayRegistryFixture } from "../../helpers/subway/topology";
import { storedSubwayTimetableRepository } from "../../helpers/subway/timetables";
import { stationCoordsFixture, storedStationCoordsRepository } from "../../helpers/subway/station-coords";
import type { FakeSubwayStationCoordsRepository } from "../../helpers/fakes/subway/subway-station-coords.repository.fake";

const at = (kst: string): Date => new Date(`2026-10-16T${kst}+09:00`);
const clock = { current: at("20:41:00"), now(): Date { return this.current; } };

let app: NestExpressApplication;
let httpServer: import("http").Server;
let subwayRepository: FakeSubwayRepository;
let stationCoordsRepository: FakeSubwayStationCoordsRepository;

beforeAll(async () => {
  subwayRepository = new FakeSubwayRepository();
  stationCoordsRepository = storedStationCoordsRepository();
  app = await buildTestApp({
    imports: [CalendarModule, SubwayModule, SubwayTimetableModule, SubwayEstimateModule, SubwayTrackingModule, SubwayMatchingModule, SubwayArrivalsModule],
    overrides: [
      { provide: CalendarRepository, useValue: new FakeCalendarRepository() },
      { provide: SubwayRepository, useValue: subwayRepository },
      { provide: SubwayTopologyRepository, useValue: storedSubwayTopologyRepository() },
      { provide: SubwayTimetableRepository, useValue: storedSubwayTimetableRepository() },
      { provide: SubwayStationCoordsRepository, useValue: stationCoordsRepository },
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
    // WHY: serverNow is what app ADR 0022 D4 adds to meta, a deliberate change of this pin.
    expect(res.body.meta).toEqual({ lang: "ko", serverNow: "2026-10-16T20:41:02+09:00" });
    expect(res.body.data.station).toEqual({ id: "hyehwa", name: "혜화", coords: { lat: 37.582336, lng: 127.001844 } });
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.lines[0]).toMatchObject({
      line: { code: "4", name: "4호선", color: "00A5DE", marker: { text: "4", color: "007FAB" } },
      platformId: "S1-4-420",
      generatedAt: "2026-10-16T20:41:00+09:00",
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
    expect(res.body.data.station).toEqual({ id: "sungkyunkwan", name: "성균관대", coords: { lat: 37.300349, lng: 126.97075 } });
    expect(res.body.data.lines.map((l: { line: unknown; platformId: string }) => [l.line, l.platformId])).toEqual([
      [{ code: "1", name: "1호선", color: "0052A4", marker: { text: "1", color: "0052A4" } }, "KR-1-0153"],
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
    expect(res.body.data.station).toEqual({ id: "gangnam", name: "강남", coords: { lat: 37.497414, lng: 127.028008 } });
    expect(res.body.data.lines.map((l: { line: unknown; platformId: string }) => [l.line, l.platformId])).toEqual([
      [{ code: "2", name: "2호선", color: "00A84D", marker: { text: "2", color: "00893F" } }, "S1-2-222"],
      [{ code: "D1", name: "신분당선", color: "D4003B", marker: { text: "신", color: "D4003B" } }, "DX-D1-4307"],
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
    expect(up.trains.find((t: { trainNo: string }) => t.trainNo === "2440")).toMatchObject({ expectedArrivalAt: "2026-10-16T20:42:50+09:00", basis: "provider" });
  });

  it("answers jamsil with its 2호선 then its 8호선 line entry, and dogok with 3호선 then 수인분당선, as the wire publishes them", async () => {
    // Act
    const jamsil = await getAt("20:41:02", "/subway/stations/jamsil/arrivals");
    const dogok = await getAt("20:41:02", "/subway/stations/dogok/arrivals");

    // Assert
    const entriesOf = (body: { data: { lines: Array<{ line: { code: string; color: string; marker: { text: string; color: string } }; platformId: string }> } }) =>
      body.data.lines.map((l) => [l.line.code, l.line.marker.text, l.line.color, l.line.marker.color, l.platformId]);
    expect(entriesOf(jamsil.body)).toEqual([
      ["2", "2", "00A84D", "00893F", "S1-2-216"],
      ["8", "8", "E6186C", "E4186B", "S1-8-2815"],
    ]);
    expect(entriesOf(dogok.body)).toEqual([
      ["3", "3", "EF7C1C", "BB5C0D", "S1-3-334"],
      ["K1", "수", "F5A200", "A26B00", "KR-K1-K217"],
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

  it("Named line in Korean: serves jeongja's 신분당 entry as D1, 신분당선, color D4003B and a 신 marker, before its 수인분당 entry", async () => {
    // Act
    const res = await getAt("20:41:02", "/subway/stations/jeongja/arrivals").set("Accept-Language", "ko");

    // Assert
    expect(res.body.data.station).toEqual({ id: "jeongja", name: "정자", coords: { lat: 37.366546, lng: 127.108237 } });
    expect(res.body.data.lines.map((l: { line: unknown }) => l.line)).toEqual([
      { code: "D1", name: "신분당선", color: "D4003B", marker: { text: "신", color: "D4003B" } },
      { code: "K1", name: "수인분당선", color: "F5A200", marker: { text: "수", color: "A26B00" } },
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
    expect(train).toMatchObject({ headsign: "신사", expectedArrivalAt: "2026-10-16T20:44:10+09:00", stopsAway: 1, basis: "estimate" });
    expect(up.trains.map((t: { trainNo: string }) => t.trainNo)).not.toContain("20");
  });

  it("Line without countdowns: serves 잠실's captured 2호선 countdowns live and none of its 8호선 trains live, whose rows carry none", async () => {
    // Arrange
    const fetchedAt = new Date("2026-10-17T21:07:00+09:00");
    const captured = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/realtime-arrival-jamsil.json"), "utf8")) as { realtimeArrivalList: SeoulArrivalRow[] };
    const jamsil = toSeoulStations(subwayRegistryFixture()).find((station) => station.seoulName === "잠실");
    const countdownRows = toCountdownRows(captured.realtimeArrivalList, jamsil?.platformBySubwayId ?? new Map(), fetchedAt);
    clock.current = fetchedAt;
    await app.get(SubwayTrackingService).track({ observe: async () => ({ source: "seoul-subway-api", events: [], countdownRows }) });

    // Act
    clock.current = new Date("2026-10-17T21:07:02+09:00");
    const res = await request(httpServer).get("/subway/stations/jamsil/arrivals");

    // Assert
    const basesOf = (index: number): string[] =>
      res.body.data.lines[index].directions.flatMap((d: { trains: Array<{ basis: string }> }) => d.trains.map((t) => t.basis));
    expect(res.body.data.lines.map((l: { platformId: string }) => l.platformId)).toEqual(["S1-2-216", "S1-8-2815"]);
    expect(basesOf(0)).toContain("provider");
    expect(basesOf(1).length).toBeGreaterThan(0);
    expect(basesOf(1).every((basis) => basis === "estimate" || basis === "timetable")).toBe(true);
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
    if (listed) expect(train).toMatchObject({ expectedArrivalAt: "2026-10-16T20:42:20+09:00", stopsAway: 0, basis: "estimate" });
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
    const bases = (body: typeof fresh.body) => directionsOf(body).flatMap((d: { trains: { basis: string }[] }) => d.trains.map((t) => t.basis));
    expect(bases(fresh.body)).toContain("estimate");
    expect(bases(stale.body)).toEqual(Array(6).fill("timetable"));
    expect(stale.body.data.lines[0].generatedAt).toBe("2026-10-16T20:41:11+09:00");
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
    expect(res.body.data.lines[0].generatedAt).toBe("2026-10-16T20:41:00+09:00");
    const train = up.trains.find((t: { trainNo: string }) => t.trainNo === "4674");
    expect(train).toMatchObject({ expectedArrivalAt: "2026-10-16T20:42:50+09:00", basis: "provider" });
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
    expect(train).toMatchObject({ stopsAway: 1, basis: "estimate" });
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
    // WHY: serverNow is what app ADR 0022 D4 adds to meta, a deliberate change of this pin.
    expect(res.body.meta).toEqual({ lang, serverNow: "2026-10-16T20:41:02+09:00" });
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

  it("marks hyehwa's first train of the service day in each direction at 05:30 on a weekday, and no later train", async () => {
    // Act
    const res = await getAt("05:30:00", "/subway/stations/hyehwa/arrivals");

    // Assert
    expect(res.status).toBe(200);
    const [up, down] = directionsOf(res.body).map((d: { trains: Array<{ trainNo: string; isFirstRun: boolean }> }) =>
      d.trains.map((t) => [t.trainNo, t.isFirstRun]),
    );
    expect(up.slice(0, 2)).toEqual([
      ["4004", true],
      ["4006", false],
    ]);
    expect(up.filter((pair) => pair[1] === true)).toHaveLength(1);
    expect(down).toEqual([
      ["4509", true],
      ["4511", false],
      ["4001", false],
    ]);
    expectWire(subwayStationArrivals, res.body.data);
  });

  it("marks no train first at 20:41, the first trains of the day long gone", async () => {
    // Act
    const res = await getAt("20:41:02", "/subway/stations/hyehwa/arrivals");

    // Assert
    expect(res.status).toBe(200);
    const firsts = directionsOf(res.body).flatMap((d: { trains: Array<{ isFirstRun: boolean }> }) => d.trains.map((t) => t.isFirstRun));
    expect(firsts).toEqual(Array(6).fill(false));
  });

  it("serves meta.serverNow, the server's clock at +09:00 when it answered, as the wire publishes it", async () => {
    // Act
    const res = await getAt("20:41:02", "/subway/stations/hyehwa/arrivals");

    // Assert
    expect(res.status).toBe(200);
    const { lang, ...meta } = res.body.meta;
    expect(lang).toBe("ko");
    expect(meta).toEqual({ serverNow: "2026-10-16T20:41:02+09:00" });
    expectWire(subwayStationArrivalsMeta, meta);
  });
});

describe("GET /subway/stations/:stationId/arrivals with stored coords that lack a station", () => {
  let lackingApp: NestExpressApplication;

  beforeAll(async () => {
    const lacking = stationCoordsFixture();
    delete lacking.stations.dogok;
    lackingApp = await buildTestApp({
      imports: [CalendarModule, SubwayModule, SubwayTimetableModule, SubwayEstimateModule, SubwayTrackingModule, SubwayMatchingModule, SubwayArrivalsModule],
      overrides: [
        { provide: CalendarRepository, useValue: new FakeCalendarRepository() },
        { provide: SubwayRepository, useValue: new FakeSubwayRepository() },
        { provide: SubwayTopologyRepository, useValue: storedSubwayTopologyRepository() },
        { provide: SubwayTimetableRepository, useValue: storedSubwayTimetableRepository() },
        { provide: SubwayStationCoordsRepository, useValue: storedStationCoordsRepository(lacking) },
        { provide: Clock, useValue: clock },
      ],
    });
  });

  afterAll(async () => {
    await lackingApp.close();
  });

  it("Deploy adds a station before its coords: answers 200 for it with null coords, its lines and its Cache-Control, as the wire publishes it", async () => {
    // Arrange
    clock.current = at("20:41:02");

    // Act
    const dogok = await request(lackingApp.getHttpServer()).get("/subway/stations/dogok/arrivals");

    // Assert
    expect(dogok.status).toBe(200);
    expect(dogok.headers["cache-control"]).toBe("private, max-age=5");
    expect(dogok.body.data.station).toEqual({ id: "dogok", name: "도곡", coords: null });
    expect(dogok.body.data.lines.map((line: { platformId: string }) => line.platformId)).toEqual(["S1-3-334", "KR-K1-K217"]);
    expectWire(subwayStationArrivals, dogok.body.data);
  });

  it("serves the coords the same revision holds for the other stations", async () => {
    // Arrange
    clock.current = at("20:41:02");

    // Act
    const yangjae = await request(lackingApp.getHttpServer()).get("/subway/stations/yangjae/arrivals");

    // Assert
    expect(yangjae.status).toBe(200);
    expect(yangjae.body.data.station).toEqual({ id: "yangjae", name: "양재", coords: { lat: 37.484143, lng: 127.034278 } });
    expectWire(subwayStationArrivals, yangjae.body.data);
  });
});
