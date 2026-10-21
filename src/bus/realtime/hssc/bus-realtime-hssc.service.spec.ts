/**
 * BusRealtimeHsscService over a scripted client and an in-memory bus_cache:
 * what a tick keeps and stores. Stale thresholds, the stop-name mapping and
 * the circular → linear sequence math are asserted exactly, and every failure
 * rejects so the poller registry counts it, leaving the served list as it was.
 * Each tick also appends the feed's events to the event log once each, every
 * row the feed sends including the ones too stale to serve, after bus_cache.
 */
import "moment/locale/ko";
import moment from "moment-timezone";
import { FakeBusCacheRepository } from "../../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeHsscRepository } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { hsscBusDoc } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import type { Clock } from "../../../infra/clock";
import type { BusCacheRepository } from "../../cache/bus-cache.repository";
import { BusCacheService } from "../../cache/bus-cache.service";
import type { BusRealtimeHsscClient } from "./bus-realtime-hssc.client";
import type { BusRealtimeHsscRepository } from "./bus-realtime-hssc.repository";
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
let feedLog: FakeBusRealtimeHsscRepository;
let service: BusRealtimeHsscService;

beforeEach(() => {
  client = new FakeBusRealtimeHsscClient();
  busCache = new FakeBusCacheRepository();
  feedLog = new FakeBusRealtimeHsscRepository();
  const cache = new BusCacheService(asReal<BusCacheRepository>(busCache));
  service = new BusRealtimeHsscService(asReal<BusRealtimeHsscClient>(client), cache, asReal<BusRealtimeHsscRepository>(feedLog), clock);
});

describe("BusRealtimeHsscService.listBuses", () => {
  it("initially returns empty array", async () => {
    // Act & Assert
    expect(await service.listBuses()).toEqual([]);
  });

  it("serves bus_cache over the process's own memory", async () => {
    // Arrange
    busCache.values.set("hssc", [hsscBusDoc({ sequence: "3" })]);

    // Act & Assert
    expect(await service.listBuses()).toEqual([hsscBusDoc({ sequence: "3" })]);
  });
});

// WHY: every role reads bus_cache only, so combined answers as an api replica does (ADR 0012, D1).
describe("BusRealtimeHsscService.listBuses after its own tick", () => {
  it("serves no bus once the bus_cache entry is gone, though a tick filled the process's memory", async () => {
    // Arrange
    client.buses = [createApiItem("혜화동로터리", "6", koreanNow())];
    await service.refresh();
    busCache.values.delete("hssc");

    // Act
    const buses = await service.listBuses();

    // Assert
    expect(buses).toEqual([]);
  });

  it("keeps the first sighting across ticks while bus_cache serves", async () => {
    // Arrange
    client.buses = [createApiItem("혜화동로터리", "6", koreanNow(2))];
    await service.refresh();
    busCache.values.delete("hssc");
    client.buses = [createApiItem("혜화동로터리", "6", koreanNow())];

    // Act
    await service.refresh();

    // Assert
    expect((await service.listBuses())[0]!.estimatedTime).toBe(120);
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

    it("stores an empty tick under `hssc`, so the key outlives a night with no bus", async () => {
      // Arrange
      client.buses = [];

      // Act
      await service.refresh();

      // Assert
      expect(busCache.values.get("hssc")).toEqual([]);
    });

    it("writes nothing on an API error", async () => {
      // Arrange
      client.failWith = new Error("HSSC response is not an array (string)");

      // Act & Assert
      await expect(service.refresh()).rejects.toThrow("not an array");
      expect(busCache.values.has("hssc")).toBe(false);
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

describe("BusRealtimeHsscService.refresh feed event log", () => {
  const LEFT_AT_ROTARY = { line_no: "32149", inout: "LEFT", stop_no: "284258", seq: "1", stop_name: "혜화동로터리", get_date: "2026-10-20 오전 9:59:30" };

  it("appends each row as an event with its parsed time and the tick's time", async () => {
    // Arrange
    client.buses = [LEFT_AT_ROTARY];

    // Act
    await service.refresh();

    // Assert
    expect(feedLog.feedEvents).toEqual([
      {
        lineNo: "32149",
        seq: 1,
        stopNo: "284258",
        stopName: "혜화동로터리",
        inout: "LEFT",
        getDate: new Date("2026-10-20T00:59:30.000Z"),
        rawGetDate: "2026-10-20 오전 9:59:30",
        polledAt: NOW,
      },
    ]);
  });

  it("hands a row the feed repeats on the next tick to no write", async () => {
    // Arrange
    client.buses = [LEFT_AT_ROTARY];
    await service.refresh();

    // Act
    await service.refresh();

    // Assert
    expect(feedLog.batches.map((batch) => batch.length)).toEqual([1, 0]);
  });

  it("appends the next event of a line, at the same stop or the next", async () => {
    // Arrange
    client.buses = [{ ...LEFT_AT_ROTARY, inout: "ENTERED", get_date: "2026-10-20 오전 9:59:10" }];
    await service.refresh();
    client.buses = [LEFT_AT_ROTARY];
    await service.refresh();
    client.buses = [{ ...LEFT_AT_ROTARY, seq: "2", get_date: "2026-10-20 오전 10:01:02" }];

    // Act
    await service.refresh();

    // Assert
    expect(feedLog.feedEvents.map((event) => [event.seq, event.inout])).toEqual([
      [1, "ENTERED"],
      [1, "LEFT"],
      [2, "LEFT"],
    ]);
  });

  it("appends a row too stale to serve, a frozen line included, once", async () => {
    // Arrange
    const frozen = { ...LEFT_AT_ROTARY, line_no: "32153", get_date: "2025-02-14 오후 3:04:05" };
    client.buses = [frozen];
    await service.refresh();

    // Act
    await service.refresh();

    // Assert
    expect(busCache.values.get("hssc")).toEqual([]);
    expect(feedLog.feedEvents).toEqual([expect.objectContaining({ lineNo: "32153", getDate: new Date("2025-02-14T06:04:05.000Z") })]);
  });

  it("keeps an EMERGENCY row as received", async () => {
    // Arrange
    client.buses = [{ ...LEFT_AT_ROTARY, inout: "EMERGENCY" }];

    // Act
    await service.refresh();

    // Assert
    expect(feedLog.feedEvents.map((event) => event.inout)).toEqual(["EMERGENCY"]);
  });

  it("leaves out a row whose time does not parse and logs the rest", async () => {
    // Arrange
    client.buses = [{ ...LEFT_AT_ROTARY, line_no: "32150", get_date: "2026-10-20 9:59:30" }, LEFT_AT_ROTARY];

    // Act
    await service.refresh();

    // Assert
    expect(feedLog.feedEvents.map((event) => event.lineNo)).toEqual(["32149"]);
  });

  it("stores an event a restarted poller sends again once", async () => {
    // Arrange
    client.buses = [LEFT_AT_ROTARY];
    await service.refresh();
    const restarted = new BusRealtimeHsscService(
      asReal<BusRealtimeHsscClient>(client),
      new BusCacheService(asReal<BusCacheRepository>(busCache)),
      asReal<BusRealtimeHsscRepository>(feedLog),
      clock,
    );

    // Act
    await restarted.refresh();

    // Assert
    expect(feedLog.feedEvents).toHaveLength(1);
  });

  it("rejects when the log write fails, after bus_cache is written, and retries the event on the next tick", async () => {
    // Arrange
    client.buses = [LEFT_AT_ROTARY];
    feedLog.failWith = new Error("mongo down");

    // Act & Assert
    await expect(service.refresh()).rejects.toThrow("mongo down");
    expect(busCache.values.has("hssc")).toBe(true);
    feedLog.failWith = null;
    await service.refresh();
    expect(feedLog.feedEvents).toEqual([expect.objectContaining({ lineNo: "32149", inout: "LEFT" })]);
  });

  it("writes no event on an API error", async () => {
    // Arrange
    client.failWith = new Error("Network error");

    // Act & Assert
    await expect(service.refresh()).rejects.toThrow("Network error");
    expect(feedLog.batches).toEqual([]);
  });
});
