/**
 * BusLiveHsscService over the HSSC buses cached in an in-memory bus_cache, the engine and the stored stops: each
 * cached bus anchored on its latest event and estimated at every stop of the line, the rotary passes never listed,
 * a bus standing at a stop leaving after the rest of its dwell, and the line without data when no bus is cached.
 * A bus whose feed said it left the turnaround (seq 5) stays there, waiting to depart, until its next stop's event (ADR 0018, D7), and
 * a bus the poller holds on an earlier row is served there, a cache entry without that row read as the feed's (D8).
 */
import { FakeBusCacheRepository } from "../../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeHsscRepository } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { hsscBusDoc } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import { storedBusStopsService } from "../../../../__tests__/helpers/bus/bus-stops";
import type { Clock } from "../../../infra/clock";
import type { BusCacheRepository } from "../../cache/bus-cache.repository";
import { BusCacheService } from "../../cache/bus-cache.service";
import type { BusRealtimeHsscClient } from "../../realtime/hssc/bus-realtime-hssc.client";
import type { BusRealtimeHsscRepository } from "../../realtime/hssc/bus-realtime-hssc.repository";
import { BusRealtimeHsscService } from "../../realtime/hssc/bus-realtime-hssc.service";
import { BusRealtimeHsscEtaService } from "../../realtime/hssc-eta/bus-realtime-hssc-eta.service";
import { BusLiveHsscService } from "./bus-live-hssc.service";

const NOW = new Date("2026-10-20T01:00:00Z");
const clock: Clock = { now: () => NOW };

function service(busCache: FakeBusCacheRepository): BusLiveHsscService {
  const cache = new BusCacheService(asReal<BusCacheRepository>(busCache));
  const hssc = new BusRealtimeHsscService(asReal<BusRealtimeHsscClient>(new FakeBusRealtimeHsscClient()), cache, asReal<BusRealtimeHsscRepository>(new FakeBusRealtimeHsscRepository()), clock);
  return new BusLiveHsscService(hssc, new BusRealtimeHsscEtaService(), storedBusStopsService(), clock);
}

describe("BusLiveHsscService.findLiveGroup", () => {
  it("estimates each cached bus at every stop of the line, leaving out the rotary passes", async () => {
    // Arrange
    const busCache = new FakeBusCacheRepository();
    // Hyehwa Station exit 1 (seq 0, the line's station 6), entered 100 s ago.
    busCache.values.set("hssc", [hsscBusDoc({ line_no: "32149", seq: "0", inout: "ENTERED", sequence: "7", get_date: "2026-10-20 오전 9:58:20", eventDate: "2026-10-20 09:58:20" })]);

    // Act
    const group = await service(busCache).findLiveGroup();

    // Assert
    expect(group.stations.map(({ stationIndex }) => stationIndex)).toEqual([0, 1, 2, 3, 4, 6, 8, 9, 10]);
    expect(group.stations.find(({ stationIndex }) => stationIndex === 6)!.arrivals).toMatchObject([
      { status: "atStop", stopsAway: 0, expectedDepartureAt: "2026-10-20T10:01:14+09:00", vehicleId: "32149" },
    ]);
    expect(group.vehicles).toMatchObject([{ id: "32149", position: { stationIndex: 6, status: "atStop" } }]);
    expect(group.vehicles[0]!.trajectory!.slice(0, 2)).toEqual([
      { at: "2026-10-20T09:58:20+09:00", s: 6 },
      { at: "2026-10-20T10:01:14+09:00", s: 6 },
    ]);
  });

  it("serves no data and no station when no bus is cached", async () => {
    // Act & Assert
    expect(await service(new FakeBusCacheRepository()).findLiveGroup()).toMatchObject({ operation: "noData", stations: [], vehicles: [], updatedAt: null });
  });
});

describe("BusLiveHsscService.findLiveGroup with a bus overdue past the bound", () => {
  it("serves a bus that left 농구장 10 min ago as still laying over: waiting to depart everywhere, no trajectory", async () => {
    // Arrange
    const busCache = new FakeBusCacheRepository();
    busCache.values.set("hssc", [hsscBusDoc({ line_no: "32150", seq: "5", inout: "LEFT", get_date: "2026-10-20 오전 9:50:00", eventDate: "2026-10-20 09:47:00" })]);

    // Act
    const group = await service(busCache).findLiveGroup();

    // Assert
    expect(group.vehicles).toMatchObject([{ id: "32150", position: { stationIndex: 0, status: "waitingToDepart", nextStationAt: null }, trajectory: null }]);
    expect(group.stations.flatMap(({ arrivals }) => arrivals).map(({ status, expectedArrivalAt, expectedDepartureAt }) => [status, expectedArrivalAt, expectedDepartureAt])).toEqual(
      group.stations.map(() => ["waitingToDepart", null, null]),
    );
    expect(group.stations.find(({ stationIndex }) => stationIndex === 1)!.arrivals[0]).toMatchObject({ stopsAway: 1 });
  });

  it("serves a bus stalled mid-route as unknown at every station, kept where it was last seen with no trajectory", async () => {
    // Arrange
    const busCache = new FakeBusCacheRepository();
    // The Olympic Memorial Hall stop (seq 8, the line's station 3), left 300 s ago against a 94 s median.
    busCache.values.set("hssc", [hsscBusDoc({ line_no: "32149", seq: "8", inout: "LEFT", get_date: "2026-10-20 오전 9:55:00", eventDate: "2026-10-20 09:54:30" })]);

    // Act
    const group = await service(busCache).findLiveGroup();

    // Assert
    expect(group.vehicles).toMatchObject([{ id: "32149", position: { stationIndex: 3, status: "inTransit", nextStationAt: null }, trajectory: null }]);
    expect(group.stations.flatMap(({ arrivals }) => arrivals).map(({ status, expectedArrivalAt, providerText }) => [status, expectedArrivalAt, providerText])).toEqual(
      group.stations.map(() => ["unknown", null, null]),
    );
  });
});

// WHY: a parked bus's LEFT fires off the stop's geofence, so moving on it took buses back past a bound (ADR 0018, D7).
describe("BusLiveHsscService.findLiveGroup after the feed says a bus left 농구장", () => {
  const leftTurnaround = (getDate: string, firstSeenAt: string) =>
    hsscBusDoc({ line_no: "32150", seq: "5", inout: "LEFT", sequence: "1", get_date: `2026-10-20 오전 ${getDate}`, eventDate: `2026-10-20 ${firstSeenAt}` });

  it.each([
    ["30 s ago, a departure inside the old 60 s bound", leftTurnaround("9:59:30", "09:50:00")],
    ["90 s ago, just past the old bound", leftTurnaround("9:58:30", "09:50:00")],
    ["12 min ago, parked past the stop, 14 min into its layover", leftTurnaround("9:48:00", "09:46:00")],
    ["30 s ago with no ENTERED before it", leftTurnaround("9:59:30", "09:59:30")],
  ])("keeps it at 농구장 waiting to depart, first there, with no trajectory, when it left %s", async (_case, bus) => {
    // Arrange
    const busCache = new FakeBusCacheRepository();
    busCache.values.set("hssc", [bus]);

    // Act
    const group = await service(busCache).findLiveGroup();

    // Assert
    expect(group.vehicles).toMatchObject([{ id: "32150", position: { stationIndex: 0, status: "waitingToDepart", nextStationAt: null }, trajectory: null }]);
    expect(group.stations.flatMap(({ arrivals }) => arrivals).map(({ status, expectedArrivalAt, expectedDepartureAt }) => [status, expectedArrivalAt, expectedDepartureAt])).toEqual(
      group.stations.map(() => ["waitingToDepart", null, null]),
    );
    expect(group.stations[0]).toMatchObject({ stationIndex: 0, arrivals: [{ stopsAway: 0, vehicleId: "32150" }] });
    expect(group.stations.find(({ stationIndex }) => stationIndex === 1)!.arrivals[0]).toMatchObject({ stopsAway: 1 });
  });

  it("moves it once its next stop reports, with ETAs from that event", async () => {
    // Arrange
    const busCache = new FakeBusCacheRepository();
    // The 600th Anniversary Hall stop going down (seq 6, the line's station 1), left 10 s ago: 44 s more of its 54 s.
    busCache.values.set("hssc", [hsscBusDoc({ line_no: "32150", seq: "6", inout: "LEFT", sequence: "2", get_date: "2026-10-20 오전 9:59:50", eventDate: "2026-10-20 09:59:40" })]);

    // Act
    const group = await service(busCache).findLiveGroup();

    // Assert
    expect(group.vehicles).toMatchObject([{ id: "32150", position: { stationIndex: 1, status: "inTransit", nextStationAt: "2026-10-20T10:00:44+09:00" } }]);
    expect(group.stations.find(({ stationIndex }) => stationIndex === 2)!.arrivals).toMatchObject([{ status: "enRoute", stopsAway: 1, expectedArrivalAt: "2026-10-20T10:00:44+09:00" }]);
  });
});

// WHY: the feed reports seq 10 for a bus past seq 1, the same rotary, on about 27% of passes (ADR 0018, D8).
describe("BusLiveHsscService.findLiveGroup with a held anchor row", () => {
  const confused = { line_no: "32149", seq: "10", inout: "LEFT_LAST", sequence: "6", get_date: "2026-10-20 오전 9:59:50", eventDate: "2026-10-20 09:59:50" };

  it("serves the bus at the held row's station, never two stations back", async () => {
    // Arrange
    const busCache = new FakeBusCacheRepository();
    const anchorRow = { seq: "1", inout: "LEFT", get_date: "2026-10-20 오전 9:59:40", stationName: "혜화동로터리 [미정차]", eventDate: "2026-10-20 09:59:30" };
    busCache.values.set("hssc", [hsscBusDoc({ ...confused, anchorRow })]);

    // Act
    const group = await service(busCache).findLiveGroup();

    // Assert
    expect(group.vehicles).toMatchObject([{ id: "32149", position: { stationIndex: 7, status: "inTransit", positionAt: "2026-10-20T09:59:40+09:00" } }]);
    expect(group.stations.find(({ stationIndex }) => stationIndex === 6)!.arrivals).toMatchObject([{ status: "waitingToDepart", stopsAway: 9 }]);
  });

  it("reads a cache entry an older poller wrote, with no anchor row, as the feed's row", async () => {
    // Arrange
    const busCache = new FakeBusCacheRepository();
    busCache.values.set("hssc", [hsscBusDoc(confused)]);

    // Act
    const group = await service(busCache).findLiveGroup();

    // Assert
    expect(group.vehicles).toMatchObject([{ id: "32149", position: { stationIndex: 5, status: "inTransit" } }]);
  });
});
