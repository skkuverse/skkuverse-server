/**
 * BusStationService over a scripted client and an in-memory bus_cache: a tick
 * keeps the Hyehwa stop's first arrival message (a "no information" text when
 * TOPIS lists none) and mirrors it to bus_cache, TOPIS's "no result" keeps the
 * last one, and /bus/station/01592 composes that message with the HSSC
 * shuttle's ETA at the Hyehwa boarding stop; any other stop is an empty list
 * with no meta.
 */
import { FakeBusCacheRepository } from "../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusStationClient } from "../../../__tests__/helpers/fakes/bus/bus-station.client.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import type { BusCacheRepository } from "../cache/bus-cache.repository";
import { BusCacheService } from "../cache/bus-cache.service";
import type { BusRealtimeHsscClient } from "../realtime/hssc/bus-realtime-hssc.client";
import { BusRealtimeHsscService } from "../realtime/hssc/bus-realtime-hssc.service";
import type { BusStationClient } from "./bus-station.client";
import { BusStationService } from "./bus-station.service";

const clock: Clock = { now: () => new Date("2026-10-20T01:00:00Z") };

let client: FakeBusStationClient;
let busCache: FakeBusCacheRepository;
let service: BusStationService;

const messagesOf = async (): Promise<unknown[]> => {
  const arrivals = (await service.listArrivals("01592")) as { data: Array<{ msg1Message: unknown }> };
  return arrivals.data.map((a) => a.msg1Message);
};

beforeEach(() => {
  client = new FakeBusStationClient();
  busCache = new FakeBusCacheRepository();
  const cache = new BusCacheService(asReal<BusCacheRepository>(busCache));
  const hssc = new BusRealtimeHsscService(asReal<BusRealtimeHsscClient>(new FakeBusRealtimeHsscClient()), cache, clock);
  service = new BusStationService(asReal<BusStationClient>(client), cache, hssc);
});

describe("BusStationService.refresh", () => {
  it("serves the first item's message and mirrors it to bus_cache", async () => {
    // Arrange
    client.messages = ["3분후[1번째 전]", "7분후[2번째 전]"];

    // Act
    await service.refresh();

    // Assert
    expect(busCache.values.get("station")).toBe("3분후[1번째 전]");
    busCache.values.clear();
    expect((await messagesOf())[0]).toBe("3분후[1번째 전]");
  });

  it("stores 정보 없음 when TOPIS lists no arrival", async () => {
    // Arrange
    client.messages = [];

    // Act
    await service.refresh();

    // Assert
    expect(busCache.values.get("station")).toBe("정보 없음");
  });

  it("treats no result (null) as a quiet success that keeps the message", async () => {
    // Arrange
    client.messages = null;

    // Act & Assert
    await expect(service.refresh()).resolves.toBeUndefined();
    expect((await messagesOf())[0]).toBe("정보 없음");
    expect(busCache.values.has("station")).toBe(false);
  });

  it("rejects a failed fetch or bus_cache write", async () => {
    // Arrange
    client.failWith = new Error("Network error");

    // Act & Assert
    await expect(service.refresh()).rejects.toThrow("Network error");
    client.failWith = null;
    client.messages = ["곧 도착"];
    busCache.failWith = new Error("mongo down");
    await expect(service.refresh()).rejects.toThrow("mongo down");
  });
});

describe("BusStationService.listArrivals", () => {
  it("non-01592 → empty data array, no totalCount meta", async () => {
    // Act & Assert
    expect(await service.listArrivals("99999")).toEqual([]);
  });

  it("01592 → the cached station message and the HSSC ETA at 혜화역(승차장), with totalCount 2", async () => {
    // Arrange
    busCache.values.set("station", "3분후[2번째 전]");
    busCache.values.set("hssc", [{ sequence: "2", estimatedTime: 30 }]);

    // Act
    const arrivals = await service.listArrivals("01592");

    // Assert
    expect(arrivals).toMatchObject({ meta: { totalCount: 2 } });
    expect(await messagesOf()).toEqual(["3분후[2번째 전]", "4 정거장 전"]);
  });

  it("01592 with nothing cached → the process's own message and no arrival information", async () => {
    // Act & Assert
    expect(await messagesOf()).toEqual(["정보 없음", "도착 정보 없음"]);
  });
});
