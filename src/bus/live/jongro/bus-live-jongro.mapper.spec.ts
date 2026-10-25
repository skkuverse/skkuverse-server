/**
 * A Jongno group's reading in the live shape (ADR 0019, D1, D5, D6, D8): one vehicle per bus, a
 * position from its tracked state with TOPIS's observation as positionAt and the poller's write as checkedAt, a
 * vehicle an arrival names without a position, each placed row a station with its stop id (aliases resolved), its
 * pole's number, its operation and at most two arrivals, a bus standing at the station first and arriving (D14), and the
 * group fresh as its staler key. A vehicle is low-floor by one row: its position's bus type when it has a position, else
 * the arrival row its plate comes from; its last-run flag is its calls', never its own (ADR 0022, D2). Every vehicle's
 * seats left is null from the reading; `withSeatsLeft` joins the
 * seats a fresh GBIS answer gives by vehicle id, changing nothing else (ADR 0019, D17).
 */
import arrivals7800 from "../../../../__tests__/nest/bus/fixtures/topis-7800-arrivals.json";
import { jongroArrivalBus, jongroPositionDoc, noArrivalBus } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import { storedRouteAttributesService } from "../../../../__tests__/helpers/bus/route-attributes";
import { isTopisPassThrough } from "../../bus.rules";
import type { JongroRouteCapabilities } from "../../bus.types";
import type { JongroArrivalBus } from "../../cache/bus-cache.document";
import { BusRealtimeArrivalService } from "../../realtime/arrival/bus-realtime-arrival.service";
import type { RealtimeArrival } from "../../realtime/group/bus-realtime-group.wire";
import type { JongroBusTracking, JongroReading } from "../../realtime/group/bus-realtime-group.types";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import { toLiveJongroGroup, withSeatsLeft } from "./bus-live-jongro.mapper";

const POSITIONS_AT = new Date("2026-10-20T00:59:55Z");
const NO_ALIASES = { stopIdByArsId: new Map<string, string>(), stopIdByTopisId: new Map<string, string>() };
const ARRIVALS_AT = new Date("2026-10-20T00:59:50Z");
const MADE_AT_MS = Date.parse("2026-10-20T00:59:00Z");

const route = {
  id: "jongro07",
  code: "07",
  busRouteId: "100900004",
  isListed: true,
  stationsVersion: "0346768f2b776f45",
  turnaroundTopisId: "100900028",
  registryStations: [
    { topisId: "100900220", arsId: "01617", stationName: "성균관대운동장", sequence: 1 },
    { topisId: "100900221", arsId: "01618", stationName: "학생회관", sequence: 2 },
    { topisId: "100900222", arsId: "0", stationName: "가상정류장", sequence: 3 },
  ],
  stations: [],
  mapping: {},
  topisIds: ["100900220", "100900221", "100900222"],
} as unknown as RegistryRoute;

const running = (extra: Partial<RealtimeArrival> = {}): RealtimeArrival => ({
  minutes: 3,
  stopsAway: 1,
  state: "running",
  isLastBus: false,
  carNumber: "5537",
  crowding: "relaxed",
  passengerCount: 9,
  message: "3분후[1번째 전]",
  ...extra,
});
const noBus = (state: RealtimeArrival["state"], message: string) =>
  ({ bus: noArrivalBus({ arrmsg: message }), arrival: running({ state, stopsAway: null, carNumber: null, crowding: null, passengerCount: null, minutes: null, message }), travelSeconds: null });

const tracking: JongroBusTracking = {
  status: "running",
  vehicleId: "100000103",
  observedAt: "2026-10-20T09:59:30+09:00",
  crowding: "relaxed",
  isLastBus: false,
  progress: 0.5,
  segmentMeters: 300,
  nextStopInSec: 40,
  trajectory: [
    { atMs: Date.parse("2026-10-20T00:59:30Z"), s: 0.5 },
    { atMs: Date.parse("2026-10-20T01:00:10Z"), s: 1 },
  ],
};

function reading(extra: Partial<JongroReading> = {}): JongroReading {
  return {
    route,
    rows: [
      { stationIndex: 1, madeAtMs: MADE_AT_MS, slots: [{ bus: jongroArrivalBus({ staOrd: 2, sectOrd: 1, traTime: 180, arrmsg: "3분후[1번째 전]" }), arrival: running(), travelSeconds: 180 }, noBus("waiting", "출발대기")] },
    ],
    positions: [{ position: jongroPositionDoc({ sequence: "1", observedAt: "2026-10-20T09:59:30+09:00" }), tracking, checkedAt: POSITIONS_AT }],
    arrivalsCheckedAt: ARRIVALS_AT,
    positionsCheckedAt: POSITIONS_AT,
    ...extra,
  };
}

describe("toLiveJongroGroup", () => {
  it("serves a tracked bus as one vehicle and its row as a station with its arrivals", () => {
    // Act
    const group = toLiveJongroGroup("jongro07", reading(), NO_ALIASES);

    // Assert
    expect(group).toEqual({
      groupId: "jongro07",
      stationsVersion: "0346768f2b776f45",
      updatedAt: "2026-10-20T09:59:50+09:00",
      operation: "running",
      vehicles: [
        {
          id: "100000103",
          plateNumber: "서울74사5537",
          occupancy: { level: "relaxed", passengerCount: 9 },
          seatsLeft: null,
          isLowFloor: null,
          position: {
            stationIndex: 0,
            status: "inTransit",
            progress: 0.5,
            sectionMeters: 300,
            coords: { lat: 37.587, lng: 126.998 },
            nextStationAt: "2026-10-20T10:00:10+09:00",
            positionAt: "2026-10-20T09:59:30+09:00",
            checkedAt: "2026-10-20T09:59:55+09:00",
          },
          trajectory: [
            { at: "2026-10-20T09:59:30+09:00", s: 0.5 },
            { at: "2026-10-20T10:00:10+09:00", s: 1 },
          ],
        },
      ],
      stations: [
        {
          stationIndex: 1,
          stopId: "seoul-01618",
          arsId: "01618",
          operation: "running",
          arrivals: [
            {
              status: "enRoute",
              expectedArrivalAt: "2026-10-20T10:02:00+09:00",
              ...{ expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
              basis: "provider",
              stopsAway: 2,
              runId: null,
              vehicleId: "100000103",
              ...{ headsign: null, isFirstRun: null, isLastRun: false, isExpress: null },
              providerText: "3분후[1번째 전]",
            },
            {
              status: "waitingToDepart",
              expectedArrivalAt: null,
              ...{ expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
              basis: "provider",
              stopsAway: null,
              runId: null,
              vehicleId: null,
              ...{ headsign: null, isFirstRun: null, isLastRun: false, isExpress: null },
              providerText: "출발대기",
            },
          ],
        },
      ],
    });
  });

  it("serves a bus an arrival names but no position row has, with no position", () => {
    // Arrange
    const unseen = { bus: jongroArrivalBus({ vehId: "100000200", plainNo: "서울74사5600", staOrd: 2 }), arrival: running({ crowding: null, passengerCount: null, isLastBus: true }), travelSeconds: 300 };

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows: [{ stationIndex: 1, madeAtMs: MADE_AT_MS, slots: [unseen] }], positions: [] }), NO_ALIASES);

    // Assert
    expect(group.vehicles).toEqual([{ id: "100000200", plateNumber: "서울74사5600", occupancy: null, seatsLeft: null, isLowFloor: null, position: null, trajectory: null }]);
  });

  it("serves a bus's last-run flag on every call naming it when any of its rows says so, and none on the vehicle", () => {
    // Arrange
    // QUIRK(topis): the arriving-soon text never carries the last-bus marker, so a bus's rows can disagree; here the nearest reads false.
    const nextStop = { bus: jongroArrivalBus({ staOrd: 2, sectOrd: 2, traTime: 40, arrmsg: "곧 도착" }), arrival: running({ state: "arriving", stopsAway: 0, message: "곧 도착" }), travelSeconds: 40 };
    const later = { bus: jongroArrivalBus({ staOrd: 3, sectOrd: 2, traTime: 180, arrmsg: "[막차] 3분후[1번째 전]" }), arrival: running({ isLastBus: true, message: "[막차] 3분후[1번째 전]" }), travelSeconds: 180 };
    const rows = [
      { stationIndex: 1, madeAtMs: MADE_AT_MS, slots: [nextStop] },
      { stationIndex: 2, madeAtMs: MADE_AT_MS, slots: [later] },
    ];

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows }), NO_ALIASES);

    // Assert
    expect(group.vehicles.map(({ id }) => id)).toEqual(["100000103"]);
    expect(group.vehicles[0]).not.toHaveProperty("isLastBus");
    expect(group.stations.flatMap(({ arrivals }) => arrivals.map(({ vehicleId, isLastRun }) => [vehicleId, isLastRun]))).toEqual([
      ["100000103", true],
      ["100000103", true],
    ]);
  });

  it("serves a bus its position shows standing at the station a row names it at as there, 0 stops away", () => {
    // Arrange
    // WHY: the position (stopFlag 1 at station index 1) is newer than the row, which still reads arriving soon there.
    const atStop = { ...tracking, status: "atStop" as const, progress: 0, nextStopInSec: null };
    const positions = [{ position: jongroPositionDoc({ sequence: "2", isAtStop: true }), tracking: atStop, checkedAt: POSITIONS_AT }];
    const slot = { bus: jongroArrivalBus({ staOrd: 2, sectOrd: 2, traTime: 10, arrmsg: "곧 도착" }), arrival: running({ state: "arriving", stopsAway: 0, message: "곧 도착" }), travelSeconds: 10 };

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows: [{ stationIndex: 1, madeAtMs: MADE_AT_MS, slots: [slot] }], positions }), NO_ALIASES);

    // Assert
    expect(group.stations[0]?.arrivals).toMatchObject([{ status: "arriving", stopsAway: 0, expectedArrivalAt: null, expectedDepartureAt: null, vehicleId: "100000103", providerText: "곧 도착" }]);
  });

  it("serves a bus standing at a station TOPIS dropped from its row first there, arriving, then the row's first slot, each vehicle once", () => {
    // Arrange
    // QUIRK(topis): a row stops naming a bus once it stands at the row's station, so this row names only the bus behind it.
    const atStop = { ...tracking, status: "atStop" as const, progress: 0, nextStopInSec: null };
    const positions = [{ position: jongroPositionDoc({ sequence: "2", isAtStop: true }), tracking: atStop, checkedAt: POSITIONS_AT }];
    const behind = { bus: jongroArrivalBus({ vehId: "100000104", plainNo: "서울74사5600", staOrd: 2, sectOrd: 1, traTime: 180, arrmsg: "3분후[1번째 전]" }), arrival: running(), travelSeconds: 180 };
    const rows = [{ stationIndex: 1, madeAtMs: MADE_AT_MS, slots: [behind, noBus("waiting", "출발대기")] }];

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows, positions }), NO_ALIASES);

    // Assert
    expect(group.stations[0]?.arrivals.map(({ status, stopsAway, vehicleId, expectedDepartureAt, providerText }) => [status, stopsAway, vehicleId, expectedDepartureAt, providerText])).toEqual([
      ["arriving", 0, "100000103", null, null],
      ["enRoute", 2, "100000104", null, "3분후[1번째 전]"],
    ]);
    expect(group.stations[0]?.arrivals.map(({ vehicleId, isLastRun }) => [vehicleId, isLastRun])).toEqual([
      ["100000103", null],
      ["100000104", false],
    ]);
    expect(group.vehicles.map(({ id }) => id)).toEqual(["100000103", "100000104"]);
  });

  it("serves a waiting bus's position with no trajectory", () => {
    // Arrange
    const waiting = { ...tracking, status: "waiting" as const, progress: 0, nextStopInSec: null, trajectory: [] };

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ positions: [{ position: jongroPositionDoc({ sequence: "1" }), tracking: waiting, checkedAt: POSITIONS_AT }] }), NO_ALIASES);

    // Assert
    expect(group.vehicles[0]).toMatchObject({ position: { status: "waitingToDepart", progress: 0, nextStationAt: null }, trajectory: null });
  });

  it("serves 운행종료 at every station as each station's operation and the group's", () => {
    // Arrange
    const ended = { stationIndex: 0, madeAtMs: MADE_AT_MS, slots: [noBus("ended", "운행종료"), noBus("ended", "운행종료")] };

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows: [ended], positions: [] }), NO_ALIASES);

    // Assert
    expect(group).toMatchObject({ operation: "ended", vehicles: [], stations: [{ stationIndex: 0, operation: "ended", arrivals: [] }] });
  });

  it("names an aliased pole by the local stop, and a virtual stop by neither id nor number", () => {
    // Arrange
    const rows = [0, 2].map((stationIndex) => ({ stationIndex, madeAtMs: MADE_AT_MS, slots: [noBus("noInfo", "정보없음")] }));

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows, positions: [] }), { ...NO_ALIASES, stopIdByArsId: new Map([["01617", "hssc-stadium"]]) });

    // Assert
    expect(group.stations.map(({ stopId, arsId, operation }) => [stopId, arsId, operation])).toEqual([
      ["hssc-stadium", "01617", "noData"],
      [null, null, "noData"],
    ]);
    expect(group.operation).toBe("noData");
  });

  it("names a pole a local stop aliases by its TOPIS station, beside one aliased by its ARS number", () => {
    // Arrange
    const rows = [0, 1, 2].map((stationIndex) => ({ stationIndex, madeAtMs: MADE_AT_MS, slots: [noBus("noInfo", "정보없음")] }));

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows, positions: [] }), { stopIdByArsId: new Map([["01617", "hssc-stadium"]]), stopIdByTopisId: new Map([["100900221", "hssc-bus-lot"]]) });

    // Assert
    expect(group.stations.map(({ stopId, arsId }) => [stopId, arsId])).toEqual([
      ["hssc-stadium", "01617"],
      ["hssc-bus-lot", "01618"],
      [null, null],
    ]);
  });

  it("serves no data and no write instant before the poller wrote", () => {
    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows: [], positions: [], arrivalsCheckedAt: null, positionsCheckedAt: null }), NO_ALIASES);

    // Assert
    expect(group).toMatchObject({ operation: "noData", updatedAt: null, vehicles: [], stations: [] });
  });
});

// WHY: low-floor is the vehicle's, so one row decides it and the vehicle never carries two answers (ADR 0019, D6).
describe("toLiveJongroGroup low floor", () => {
  const slotOf = (bus: Parameters<typeof jongroArrivalBus>[0], extra: Partial<RealtimeArrival> = {}) => ({ bus: jongroArrivalBus({ staOrd: 2, ...bus }), arrival: running(extra), travelSeconds: 180 });
  const rowsOf = (...slots: ReturnType<typeof slotOf>[]) => [{ stationIndex: 1, madeAtMs: MADE_AT_MS, slots }];
  const positionsOf = (busType?: "lowFloor" | "general") => [{ position: jongroPositionDoc({ sequence: "1", ...(busType && { busType }) }), tracking, checkedAt: POSITIONS_AT }];

  it.each([
    ["lowFloor", true],
    ["general", false],
  ] as const)("serves a tracked bus whose position reads %s as low-floor %s", (busType, expected) => {
    // Act
    const group = toLiveJongroGroup("jongro07", reading({ positions: positionsOf(busType) }), NO_ALIASES);

    // Assert
    expect(group.vehicles.map(({ id, isLowFloor }) => [id, isLowFloor])).toEqual([["100000103", expected]]);
  });

  it("serves a tracked bus by its position when its arrival rows disagree", () => {
    // Arrange
    const rows = rowsOf(slotOf({ busType: "general" }));

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows, positions: positionsOf("lowFloor") }), NO_ALIASES);

    // Assert
    expect(group.vehicles.map(({ id, isLowFloor }) => [id, isLowFloor])).toEqual([["100000103", true]]);
  });

  it("serves a tracked bus whose position names no type as unknown, whatever its arrival rows say", () => {
    // Arrange
    const rows = rowsOf(slotOf({ busType: "lowFloor" }));

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows, positions: positionsOf() }), NO_ALIASES);

    // Assert
    expect(group.vehicles.map(({ id, isLowFloor }) => [id, isLowFloor])).toEqual([["100000103", null]]);
  });

  it("serves a bus only an arrival names by the row its plate comes from", () => {
    // Arrange
    const unseen = (staOrd: number, busType: "lowFloor" | "general") => slotOf({ vehId: "100000200", plainNo: "서울75사2010", staOrd, busType });
    const rows = [
      { stationIndex: 2, madeAtMs: MADE_AT_MS, slots: [unseen(3, "general")] },
      { stationIndex: 1, madeAtMs: MADE_AT_MS, slots: [unseen(2, "lowFloor")] },
    ];

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows, positions: [] }), NO_ALIASES);

    // Assert
    expect(group.vehicles.map(({ id, plateNumber, isLowFloor }) => [id, plateNumber, isLowFloor])).toEqual([["100000200", "서울75사2010", true]]);
  });

  it("serves every bus as unknown from rows a poller older than the bus type wrote", () => {
    // Arrange
    const rows = rowsOf(slotOf({}), slotOf({ vehId: "100000200", plainNo: "서울75사2010" }));

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows, positions: positionsOf() }), NO_ALIASES);

    // Assert
    expect(group.vehicles.map(({ id, isLowFloor }) => [id, isLowFloor])).toEqual([
      ["100000103", null],
      ["100000200", null],
    ]);
  });
});

// WHY: 7800 as TOPIS answered it on 2026-10-24 (topis-7800-arrivals.json), each row read slot by slot as the realtime
// view reads it, on a route stated as the TOPIS list will state it (unlisted, GPS, no load): it runs through the Jongno
// path unchanged except that stops away leave out its 19 `…(미정차)` stations and no vehicle serves an occupancy.
describe("toLiveJongroGroup on 7800's captured rows", () => {
  const rows7800 = arrivals7800.msgBody.itemList;
  const MADE_AT_7800_MS = Date.parse("2026-10-24T17:51:03+09:00");
  const CHECKED_AT_7800 = new Date("2026-10-24T08:51:10Z");
  const CAPABILITIES_7800 = { positionSource: "gps", occupancy: false, plateNumber: true, lastBus: true, lowFloor: true } as const;
  const arrivalService = new BusRealtimeArrivalService(storedRouteAttributesService());

  // The test's own reading of a captured row's two slots, as BusRealtimeJongroClient reads them.
  const capturedBuses = (row: (typeof rows7800)[number]): JongroArrivalBus[] =>
    (["1", "2"] as const).map((slot) => {
      const field = (name: string) => (row as Record<string, string>)[`${name}${slot}`]!;
      return {
        traTime: Number(field("traTime")),
        sectOrd: Number(field("sectOrd")),
        staOrd: Number(row.staOrd),
        arrmsg: field("arrmsg"),
        isLast: field("isLast") === "1",
        plainNo: field("plainNo"),
        vehId: field("vehId"),
        rerideDiv: Number(field("rerdie_Div")),
        rerideNum: Number(field("reride_Num")),
      };
    });

  const passThroughOrds = new Set(rows7800.filter((row) => isTopisPassThrough(row.stNm)).map((row) => Number(row.staOrd)));
  const reading7800 = (capabilities: JongroRouteCapabilities): JongroReading => ({
    route: {
      ...{ id: "gyeonggi7800", code: "7800", busRouteId: "200000150", capabilities, isListed: false, pollIntervalMs: 30_000 },
      stationsVersion: "7800000000000000",
      turnaroundTopisId: "121001315",
      registryStations: rows7800.map((row) => ({ topisId: row.stId, arsId: row.arsId, stationName: row.stNm, sequence: Number(row.staOrd) })),
      stations: [],
      mapping: {},
      topisIds: rows7800.map((row) => row.stId),
      passThroughOrds,
    },
    rows: rows7800.map((row) => ({
      stationIndex: Number(row.staOrd) - 1,
      madeAtMs: MADE_AT_7800_MS,
      slots: arrivalService.toTimedArrivals(capturedBuses(row), { seatCount: 45, capabilities, passThroughOrds }),
    })),
    positions: [],
    arrivalsCheckedAt: CHECKED_AT_7800,
    positionsCheckedAt: CHECKED_AT_7800,
  });
  const arrivalsAt = (group: ReturnType<typeof toLiveJongroGroup>, staOrd: number) => group.stations.find((station) => station.stationIndex === staOrd - 1)!.arrivals;

  it("serves [0번째 전] en route at mkTm plus its travel time, 1 stop away", () => {
    // Act
    const group = toLiveJongroGroup("gyeonggi7800", reading7800(CAPABILITIES_7800), NO_ALIASES);

    // Assert
    expect(arrivalsAt(group, 26)[0]).toEqual({
      status: "enRoute",
      expectedArrivalAt: "2026-10-24T17:53:37+09:00",
      ...{ expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
      basis: "provider",
      stopsAway: 1,
      runId: null,
      vehicleId: "200010901",
      ...{ headsign: null, isFirstRun: null, isLastRun: false, isExpress: null },
      providerText: "2분34초후[0번째 전]",
    });
  });

  it("serves both slots at 호매실동차고지 waiting to depart, naming no vehicle, and the station running", () => {
    // Act
    const group = toLiveJongroGroup("gyeonggi7800", reading7800(CAPABILITIES_7800), NO_ALIASES);

    // Assert
    expect(group.stations[0]).toMatchObject({ stationIndex: 0, stopId: null, arsId: null, operation: "running" });
    expect(group.stations[0]!.arrivals.map(({ status, vehicleId, stopsAway, providerText }) => [status, vehicleId, stopsAway, providerText])).toEqual([
      ["waitingToDepart", null, null, "출발대기"],
      ["waitingToDepart", null, null, "출발대기"],
    ]);
  });

  it("counts only the stations a bus stops at, which TOPIS's [N번째 전] does not", () => {
    // Act
    const group = toLiveJongroGroup("gyeonggi7800", reading7800(CAPABILITIES_7800), NO_ALIASES);

    // Assert
    const counts = (staOrd: number) => arrivalsAt(group, staOrd).map(({ providerText, stopsAway }) => [providerText, stopsAway]);
    expect(counts(31)).toEqual([
      ["10분25초후[5번째 전]", 3],
      ["17분57초후[8번째 전]", 6],
    ]);
    expect(counts(37)).toEqual([
      ["2분51초후[1번째 전]", 1],
      ["12분18초후[5번째 전]", 1],
    ]);
    expect(counts(25)).toEqual([
      ["6분38초후[2번째 전]", 3],
      ["19분57초후[9번째 전]", 10],
    ]);
  });

  it("names a stop only at a pole a local stop aliases, by TOPIS station or ARS number, since /bus/config lists no 7800", () => {
    // Arrange
    const stopIdByArsId = new Map([["20253", "sadang-exit9"]]);
    const stopIdByTopisId = new Map([["200000162", "nsc-skku-to-sadang"]]);

    // Act
    const group = toLiveJongroGroup("gyeonggi7800", reading7800(CAPABILITIES_7800), { stopIdByArsId, stopIdByTopisId });

    // Assert
    const stopsAt = (staOrd: number) => group.stations.find((station) => station.stationIndex === staOrd - 1)!;
    expect([24, 41, 31, 39, 58].map((staOrd) => [staOrd, stopsAt(staOrd).stopId, stopsAt(staOrd).arsId])).toEqual([
      [24, "nsc-skku-to-sadang", null],
      [41, "sadang-exit9", "20253"],
      [31, null, "27113"],
      [39, null, "22028"],
      [58, null, null],
    ]);
  });

  it("serves no vehicle an occupancy on a route whose source reports no load, and the rows' reading on one that does", () => {
    // Act
    const unreported = toLiveJongroGroup("gyeonggi7800", reading7800(CAPABILITIES_7800), NO_ALIASES);
    const reported = toLiveJongroGroup("gyeonggi7800", reading7800({ ...CAPABILITIES_7800, occupancy: true }), NO_ALIASES);

    // Assert
    expect(unreported.vehicles).toHaveLength(15);
    expect(unreported.vehicles.filter(({ occupancy }) => occupancy !== null)).toEqual([]);
    expect(reported.vehicles.find(({ id }) => id === "200011532")?.occupancy).toEqual({ level: "relaxed", passengerCount: 0 });
  });

  it("serves every vehicle's seats left as null from the reading alone", () => {
    // Act
    const group = toLiveJongroGroup("gyeonggi7800", reading7800(CAPABILITIES_7800), NO_ALIASES);

    // Assert
    expect(group.vehicles.filter(({ seatsLeft }) => seatsLeft !== null)).toEqual([]);
  });
});

describe("withSeatsLeft", () => {
  const unseen = { bus: jongroArrivalBus({ vehId: "100000200", plainNo: "서울74사5600", staOrd: 2 }), arrival: running(), travelSeconds: 300 };
  const group = () => {
    const rows = [{ stationIndex: 1, madeAtMs: MADE_AT_MS, slots: [unseen] }];
    return toLiveJongroGroup("jongro07", reading({ rows }), NO_ALIASES);
  };

  it("joins each vehicle's seats left by its id, tracked or not, 0 included, and null for one the seats do not name", () => {
    // Arrange
    const seatsLeftById = new Map([
      ["100000103", 0],
      ["200011684", 37],
    ]);

    // Act
    const joined = withSeatsLeft(group(), seatsLeftById);

    // Assert
    expect(joined.vehicles.map(({ id, seatsLeft }) => [id, seatsLeft])).toEqual([
      ["100000103", 0],
      ["100000200", null],
    ]);
    expect(withSeatsLeft(group(), new Map([["100000200", 12]])).vehicles.map(({ seatsLeft }) => seatsLeft)).toEqual([null, 12]);
  });

  it("changes nothing but seatsLeft, keeping each vehicle's key order", () => {
    // Arrange
    const served = group();

    // Act
    const joined = withSeatsLeft(served, new Map([["100000103", 41]]));

    // Assert
    expect(JSON.stringify(joined)).toBe(JSON.stringify(served).replace('"seatsLeft":null', '"seatsLeft":41'));
  });

  it("serves the group unchanged with no seats", () => {
    // Act & Assert
    expect(withSeatsLeft(group(), new Map())).toEqual(group());
  });
});
