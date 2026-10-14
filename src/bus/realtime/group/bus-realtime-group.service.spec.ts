/**
 * BusRealtimeGroupService over scripted clients and an in-memory bus_cache:
 * the HSSC group serves the cached HSSC buses and no ETAs, a Jongro group its
 * route's positions and arrival ETAs, an unknown group is a 404, and meta
 * carries the KST clock and the bus count.
 */
import { FakeBusCacheRepository } from "../../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeJongroClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../../infra/clock";
import type { BusCacheRepository } from "../../cache/bus-cache.repository";
import { BusCacheService } from "../../cache/bus-cache.service";
import type { BusRealtimeHsscClient } from "../hssc/bus-realtime-hssc.client";
import { BusRealtimeHsscService } from "../hssc/bus-realtime-hssc.service";
import type { BusRealtimeJongroClient } from "../jongro/bus-realtime-jongro.client";
import { BusRealtimeJongroService } from "../jongro/bus-realtime-jongro.service";
import { BusRealtimeGroupService } from "./bus-realtime-group.service";

const NOW = new Date("2026-10-20T01:00:00Z");
const clock: Clock = { now: () => NOW };

let busCache: FakeBusCacheRepository;
let service: BusRealtimeGroupService;

beforeEach(() => {
  busCache = new FakeBusCacheRepository();
  const cache = new BusCacheService(asReal<BusCacheRepository>(busCache));
  const hssc = new BusRealtimeHsscService(asReal<BusRealtimeHsscClient>(new FakeBusRealtimeHsscClient()), cache, clock);
  const jongro = new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(new FakeBusRealtimeJongroClient()), cache, clock);
  service = new BusRealtimeGroupService(hssc, jongro, clock);
});

describe("BusRealtimeGroupService.getGroup", () => {
  it("serves the cached HSSC buses with no station ETAs", async () => {
    // Arrange
    busCache.values.set("hssc", [{ sequence: "2", carNumber: "0000", estimatedTime: 30 }]);

    // Act
    const group = await service.getGroup("hssc");

    // Assert
    expect(group).toEqual({
      data: { groupId: "hssc", buses: [{ stationIndex: 1, carNumber: "0000", estimatedTime: 30 }], stationEtas: [] },
      meta: { currentTime: "10:00 AM", totalBuses: 1 },
    });
  });

  it("serves a Jongro route's positions and its arrival ETAs by ord", async () => {
    // Arrange
    busCache.values.set("jongro_locations_07", [
      { sequence: "6", carNumber: "5537", estimatedTime: 0, latitude: "37.587", longitude: "126.998" },
    ]);
    busCache.values.set("jongro_stations_07", [
      { stationId: "100900220", sequence: "1", eta: "3분후[2번째 전]" },
      { stationId: "100000424", sequence: "3", eta: "" },
    ]);

    // Act
    const group = await service.getGroup("jongro07");

    // Assert
    expect(group.data).toEqual({
      groupId: "jongro07",
      buses: [{ stationIndex: 5, carNumber: "5537", estimatedTime: 0, latitude: "37.587", longitude: "126.998" }],
      stationEtas: [{ stationIndex: 0, eta: "3분후[2번째 전]" }],
    });
  });

  it("serves an empty group when neither bus_cache nor memory has buses", async () => {
    // Act & Assert
    expect((await service.getGroup("jongro08")).data).toEqual({ groupId: "jongro08", buses: [], stationEtas: [] });
  });

  it("refuses an unknown group with GROUP_NOT_FOUND", async () => {
    // Act & Assert
    await expect(service.getGroup("nope")).rejects.toMatchObject({
      code: "GROUP_NOT_FOUND",
      message: "Unknown groupId: nope",
      httpStatus: 404,
    });
  });
});
