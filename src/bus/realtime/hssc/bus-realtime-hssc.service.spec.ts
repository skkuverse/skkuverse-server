/**
 * BusRealtimeHsscService over a scripted client and an in-memory bus_cache:
 * what a tick keeps and stores. Stale thresholds, the stop-name mapping and
 * the circular → linear sequence math are asserted exactly, and every failure
 * rejects so the poller registry counts it, leaving the served list as it was.
 */
import "moment/locale/ko";
import moment from "moment-timezone";
import { FakeBusCacheRepository } from "../../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../../infra/clock";
import type { BusCacheRepository } from "../../cache/bus-cache.repository";
import { BusCacheService } from "../../cache/bus-cache.service";
import type { BusRealtimeHsscClient } from "./bus-realtime-hssc.client";
import { BusRealtimeHsscService } from "./bus-realtime-hssc.service";

const NOW = new Date("2026-10-20T01:00:00Z");
const clock: Clock = { now: () => NOW };

function koreanNow(offsetMinutes = 0): string {
  const t = moment(NOW).tz("Asia/Seoul");
  if (offsetMinutes) t.subtract(offsetMinutes, "minutes");
  return t.locale("ko").format("YYYY-MM-DD a h:mm:ss");
}

function createApiItem(
  stop_name: string,
  seq: string,
  get_date: string,
  line_no = "1",
  stop_no = "1",
) {
  return { stop_name, seq, get_date, line_no, stop_no, inout: "LEFT" };
}

let client: FakeBusRealtimeHsscClient;
let busCache: FakeBusCacheRepository;
let service: BusRealtimeHsscService;

beforeEach(() => {
  client = new FakeBusRealtimeHsscClient();
  busCache = new FakeBusCacheRepository();
  const cache = new BusCacheService(asReal<BusCacheRepository>(busCache));
  service = new BusRealtimeHsscService(asReal<BusRealtimeHsscClient>(client), cache, clock);
});

describe("BusRealtimeHsscService.listBuses", () => {
  it("initially returns empty array", async () => {
    // Act & Assert
    expect(await service.listBuses()).toEqual([]);
  });

  it("serves bus_cache over the process's own memory", async () => {
    // Arrange
    busCache.values.set("hssc", [{ sequence: "3" }]);

    // Act & Assert
    expect(await service.listBuses()).toEqual([{ sequence: "3" }]);
  });
});

describe("BusRealtimeHsscService.refresh", () => {
  describe("stopNameMapping", () => {
    it("maps 농구장정류소 correctly", async () => {
      // Arrange
      client.buses = [createApiItem("농구장정류소", "5", koreanNow())];

      // Act
      await service.refresh();

      // Assert
      const result = await service.listBuses();
      expect(result.length).toBe(1);
      expect(result[0]!.stationName).toBe("농구장 (셔틀버스정류소)");
    });

    it("maps 혜화동로터리 correctly", async () => {
      // Arrange
      client.buses = [createApiItem("혜화동로터리", "6", koreanNow())];

      // Act
      await service.refresh();

      // Assert
      const result = await service.listBuses();
      expect(result.length).toBe(1);
      expect(result[0]!.stationName).toBe("혜화동로터리 [미정차]");
    });

    it("passes unmapped names through", async () => {
      // Arrange
      client.buses = [createApiItem("새로운정류장", "3", koreanNow())];

      // Act
      await service.refresh();

      // Assert
      expect((await service.listBuses())[0]!.stationName).toBe("새로운정류장");
    });
  });

  describe("sequence calculation", () => {
    it.each([
      [5, "1"],
      [0, "7"],
      [8, "4"],
      [10, "6"],
    ])("seq=%i → realsequence=%s", async (seq, expected) => {
      // Arrange
      client.buses = [createApiItem("성균관대입구사거리", String(seq), koreanNow())];

      // Act
      await service.refresh();

      // Assert
      expect((await service.listBuses())[0]!.sequence).toBe(expected);
    });
  });

  describe("time filtering", () => {
    it("keeps items within 10min for non-농구장 stations", async () => {
      // Arrange
      client.buses = [createApiItem("혜화동로터리", "6", koreanNow(5))];

      // Act
      await service.refresh();

      // Assert
      expect((await service.listBuses()).length).toBe(1);
    });

    it("filters out items older than 10min for non-농구장 stations", async () => {
      // Arrange
      client.buses = [createApiItem("혜화동로터리", "6", koreanNow(15))];

      // Act
      await service.refresh();

      // Assert
      expect((await service.listBuses()).length).toBe(0);
    });

    it("filters out 농구장 items older than 3min", async () => {
      // Arrange
      client.buses = [createApiItem("농구장정류소", "5", koreanNow(4))];

      // Act
      await service.refresh();

      // Assert
      expect((await service.listBuses()).length).toBe(0);
    });

    it("keeps 농구장 items within 3min", async () => {
      // Arrange
      client.buses = [createApiItem("농구장정류소", "5", koreanNow(2))];

      // Act
      await service.refresh();

      // Assert
      expect((await service.listBuses()).length).toBe(1);
    });
  });

  describe("dwell timer", () => {
    it("keeps a bus's first sighting at the same stop, so its seconds there grow", async () => {
      // Arrange
      client.buses = [createApiItem("혜화동로터리", "6", koreanNow(2))];
      await service.refresh();
      client.buses = [createApiItem("혜화동로터리", "6", koreanNow())];

      // Act
      await service.refresh();

      // Assert
      expect((await service.listBuses())[0]!.estimatedTime).toBe(120);
    });
  });

  describe("empty/error responses", () => {
    it("handles empty API response", async () => {
      // Arrange
      client.buses = [];

      // Act
      await service.refresh();

      // Assert
      expect(await service.listBuses()).toEqual([]);
    });

    // Failures reject so the poller registry can count them (it logs the
    // transitions); the served list stays as it was.
    it("rejects on an API error and keeps the previous state", async () => {
      // Arrange
      client.failWith = new Error("Network error");

      // Act & Assert
      await expect(service.refresh()).rejects.toThrow("Network error");
      expect(await service.listBuses()).toEqual([]);
    });

    it("rejects when the bus_cache write fails — api replicas would serve stale data", async () => {
      // Arrange
      client.buses = [];
      busCache.failWith = new Error("mongo down");

      // Act & Assert
      await expect(service.refresh()).rejects.toThrow("mongo down");
    });

    it("stores what it keeps under `hssc`", async () => {
      // Arrange
      client.buses = [createApiItem("혜화동로터리", "6", koreanNow())];

      // Act
      await service.refresh();

      // Assert
      expect(busCache.values.get("hssc")).toEqual([expect.objectContaining({ stationName: "혜화동로터리 [미정차]" })]);
    });
  });
});
