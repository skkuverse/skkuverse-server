/**
 * BusLiveHsscService over the HSSC buses cached in an in-memory bus_cache, the engine and the stored stops: each
 * cached bus anchored on its latest event and estimated at every stop of the line, the rotary passes never listed,
 * a bus standing at a stop leaving after the rest of its dwell, and the line without data when no bus is cached.
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
