/**
 * BusRealtimeGroupService over scripted clients and an in-memory bus_cache:
 * the HSSC group serves the cached HSSC buses and no ETAs, a Jongro group its
 * route's positions and arrival ETAs with each station's arrivals (a doc the
 * previous poller wrote serves none and is logged once), an unknown group is
 * a 404, and meta carries the KST clock and the bus count.
 */
jest.mock("../../../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { FakeBusCacheRepository } from "../../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeJongroClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import {
  hsscBusDoc,
  jongroArrivalBus,
  jongroArrivalDoc,
  jongroPositionDoc,
  legacyJongroArrivalDoc,
  noArrivalBus,
} from "../../../../__tests__/helpers/bus/bus-cache-docs";
import type { Clock } from "../../../infra/clock";
import type { BusCacheRepository } from "../../cache/bus-cache.repository";
import { BusCacheService } from "../../cache/bus-cache.service";
import { BusRealtimeArrivalService } from "../arrival/bus-realtime-arrival.service";
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
  service = new BusRealtimeGroupService(hssc, jongro, new BusRealtimeArrivalService(), clock);
});

describe("BusRealtimeGroupService.getGroup", () => {
  it("serves the cached HSSC buses with no station ETAs", async () => {
    // Arrange
    busCache.values.set("hssc", [hsscBusDoc({ sequence: "2", carNumber: "0000", estimatedTime: 30 })]);

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
      jongroPositionDoc({ sequence: "6", carNumber: "5537", estimatedTime: 0, latitude: "37.587", longitude: "126.998" }),
    ]);
    busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({ stationId: "100900220", sequence: "1", eta: "3분후[2번째 전]" }),
      jongroArrivalDoc({ stationId: "100000424", sequence: "3", eta: "", buses: [noArrivalBus(), noArrivalBus()] }),
    ]);

    // Act
    const group = await service.getGroup("jongro07");

    // Assert
    // WHY: arrivals is the field this change adds (improve-jongro-realtime 3.1); the rest is as before.
    expect(group.data).toEqual({
      groupId: "jongro07",
      buses: [{ stationIndex: 5, carNumber: "5537", estimatedTime: 0, latitude: "37.587", longitude: "126.998" }],
      stationEtas: [
        {
          stationIndex: 0,
          eta: "3분후[2번째 전]",
          arrivals: [
            {
              minutes: 3,
              stopsAway: 1,
              state: "running",
              isLastBus: false,
              carNumber: "5537",
              crowding: "relaxed",
              passengerCount: 9,
              message: "3분후[2번째 전]",
            },
          ],
        },
      ],
    });
  });

  it("serves a station's first and second bus in that order, judged on the route's seat count", async () => {
    // Arrange
    busCache.values.set("jongro_stations_08", [
      jongroArrivalDoc({
        stationId: "100000102",
        sequence: "15",
        eta: "곧 도착",
        buses: [
          jongroArrivalBus({ arrmsg: "곧 도착", traTime: 112, staOrd: 15, sectOrd: 15, plainNo: "서울70사5504", rerideNum: 6 }),
          jongroArrivalBus({ arrmsg: "7분50초후[4번째 전]", traTime: 470, staOrd: 15, sectOrd: 11, plainNo: "서울70사5535", rerideNum: 28 }),
        ],
      }),
    ]);

    // Act
    const group = await service.getGroup("jongro08");

    // Assert
    expect(group.data.stationEtas).toEqual([
      {
        stationIndex: 14,
        eta: "곧 도착",
        arrivals: [
          {
            minutes: null,
            stopsAway: 0,
            state: "arriving",
            isLastBus: false,
            carNumber: "5504",
            crowding: "relaxed",
            passengerCount: 6,
            message: "곧 도착",
          },
          {
            minutes: 8,
            stopsAway: 4,
            state: "running",
            isLastBus: false,
            carNumber: "5535",
            crowding: "crowded",
            passengerCount: 28,
            message: "7분50초후[4번째 전]",
          },
        ],
      },
    ]);
  });

  it("serves only the first bus when TOPIS sends no second text", async () => {
    // Arrange
    busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({ buses: [jongroArrivalBus({ arrmsg: "3분후[2번째 전]" }), noArrivalBus({ arrmsg: "" })] }),
    ]);

    // Act
    const group = await service.getGroup("jongro07");

    // Assert
    expect(group.data.stationEtas[0]!.arrivals.map((arrival) => arrival.message)).toEqual(["3분후[2번째 전]"]);
  });

  it("serves eta and no arrivals from a doc the previous poller wrote, logging it once per process", async () => {
    // Arrange
    const logger = require("../../../infra/logger") as { info: jest.Mock };
    logger.info.mockClear();
    busCache.values.set("jongro_stations_07", [legacyJongroArrivalDoc({ stationId: "100900220", sequence: "1", eta: "3분후[2번째 전]" })]);

    // Act
    const first = await service.getGroup("jongro07");
    await service.getGroup("jongro07");

    // Assert
    expect(first.data.stationEtas).toEqual([{ stationIndex: 0, eta: "3분후[2번째 전]", arrivals: [] }]);
    const legacyLogs = logger.info.mock.calls.filter(([fields]) => fields?.event === "bus.jongro.legacy_arrivals");
    expect(legacyLogs).toHaveLength(1);
    expect(legacyLogs[0]![0]).toMatchObject({ code: "07" });
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
