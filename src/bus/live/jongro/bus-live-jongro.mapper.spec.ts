/**
 * A Jongno group's reading in the live shape (ADR 0019, D1, D5, D6, D8): one vehicle per bus, a
 * position from its tracked state with TOPIS's observation as positionAt and the poller's write as checkedAt, a
 * vehicle an arrival names without a position, each placed row a station with its stop id (aliases resolved), its
 * pole's number, its operation and at most two arrivals, and the group fresh as its staler key.
 */
import { jongroArrivalBus, jongroPositionDoc, noArrivalBus } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import type { RealtimeArrival } from "../../realtime/group/bus-realtime-group.wire";
import type { JongroBusTracking, JongroReading } from "../../realtime/group/bus-realtime-group.types";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import { toLiveJongroGroup } from "./bus-live-jongro.mapper";

const POSITIONS_AT = new Date("2026-10-20T00:59:55Z");
const ARRIVALS_AT = new Date("2026-10-20T00:59:50Z");
const MADE_AT_MS = Date.parse("2026-10-20T00:59:00Z");

const route = {
  id: "jongro07",
  code: "07",
  busRouteId: "100900004",
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
    const group = toLiveJongroGroup("jongro07", reading(), new Map());

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
          isLastBus: false,
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
              stopsAway: 1,
              isLastBus: false,
              vehicleId: "100000103",
              providerText: "3분후[1번째 전]",
            },
            {
              status: "waitingToDepart",
              expectedArrivalAt: null,
              ...{ expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
              basis: "provider",
              stopsAway: null,
              isLastBus: false,
              vehicleId: null,
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
    const group = toLiveJongroGroup("jongro07", reading({ rows: [{ stationIndex: 1, madeAtMs: MADE_AT_MS, slots: [unseen] }], positions: [] }), new Map());

    // Assert
    expect(group.vehicles).toEqual([{ id: "100000200", plateNumber: "서울74사5600", occupancy: null, isLastBus: true, position: null, trajectory: null }]);
  });

  it("serves a waiting bus's position with no trajectory", () => {
    // Arrange
    const waiting = { ...tracking, status: "waiting" as const, progress: 0, nextStopInSec: null, trajectory: [] };

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ positions: [{ position: jongroPositionDoc({ sequence: "1" }), tracking: waiting, checkedAt: POSITIONS_AT }] }), new Map());

    // Assert
    expect(group.vehicles[0]).toMatchObject({ position: { status: "waitingToDepart", progress: 0, nextStationAt: null }, trajectory: null });
  });

  it("serves 운행종료 at every station as each station's operation and the group's", () => {
    // Arrange
    const ended = { stationIndex: 0, madeAtMs: MADE_AT_MS, slots: [noBus("ended", "운행종료"), noBus("ended", "운행종료")] };

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows: [ended], positions: [] }), new Map());

    // Assert
    expect(group).toMatchObject({ operation: "ended", vehicles: [], stations: [{ stationIndex: 0, operation: "ended", arrivals: [] }] });
  });

  it("names an aliased pole by the local stop, and a virtual stop by neither id nor number", () => {
    // Arrange
    const rows = [0, 2].map((stationIndex) => ({ stationIndex, madeAtMs: MADE_AT_MS, slots: [noBus("noInfo", "정보없음")] }));

    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows, positions: [] }), new Map([["01617", "hssc-stadium"]]));

    // Assert
    expect(group.stations.map(({ stopId, arsId, operation }) => [stopId, arsId, operation])).toEqual([
      ["hssc-stadium", "01617", "noData"],
      [null, null, "noData"],
    ]);
    expect(group.operation).toBe("noData");
  });

  it("serves no data and no write instant before the poller wrote", () => {
    // Act
    const group = toLiveJongroGroup("jongro07", reading({ rows: [], positions: [], arrivalsCheckedAt: null, positionsCheckedAt: null }), new Map());

    // Assert
    expect(group).toMatchObject({ operation: "noData", updatedAt: null, vehicles: [], stations: [] });
  });
});
