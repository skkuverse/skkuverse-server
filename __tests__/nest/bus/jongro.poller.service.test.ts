/**
 * Nest port of jongro-transform.test.ts — JongroPollerService is the exact port
 * of features/bus/jongro.fetcher.ts.
 *
 * The single 40s poller tick iterates the registry and calls the (private)
 * list + loc updaters per route. We capture the registered tick fn via the
 * registry stub and invoke it directly (deterministic, no fake timers), with
 * axios mocked to return the same shape to every URL — so both registered codes
 * ("02","07") get populated, matching the Express test's "both get the same
 * data" behavior. carNumber slice(-4), the stId→staOrd mapping, and the
 * location station-name mapping are asserted verbatim.
 */

jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { JongroPollerService } from "../../../src/bus/fetchers/jongro.poller.service";
import { jongroRoutes } from "../../../src/bus/registry/jongro-registry";
import type { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";
import type { BusCacheService } from "../../../src/bus/cache/bus-cache.service";

const axios = require("axios");

let capturedTicks: Array<() => unknown> = [];
const registryStub = {
  registerPoller: jest.fn((fn: () => unknown) => {
    capturedTicks.push(fn);
  }),
} as unknown as PollerRegistryService;
const cacheStub = { write: jest.fn().mockResolvedValue(undefined) } as unknown as BusCacheService;

let service: JongroPollerService;

/** Runs every route's tick; returns their outcomes (a failed tick rejects). */
async function runTickAndFlush(): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled(capturedTicks.map((tick) => tick()));
}

beforeEach(() => {
  jest.clearAllMocks();
  capturedTicks = [];
  service = new JongroPollerService(registryStub, cacheStub, jongroRoutes);
  service.onModuleInit();
});

describe("JongroPollerService", () => {
  it("onModuleInit registers one 40s poller per route", () => {
    for (const route of jongroRoutes) {
      expect(registryStub.registerPoller).toHaveBeenCalledWith(
        expect.any(Function),
        40000,
        `jongro-${route.code}`,
      );
    }
    expect(registryStub.registerPoller).toHaveBeenCalledTimes(jongroRoutes.length);
  });

  describe("getJongroBusList", () => {
    it("initially returns undefined for uninitialized codes", () => {
      expect(service.getJongroBusList("07")).toBeUndefined();
      expect(service.getJongroBusList("02")).toBeUndefined();
    });

    it("maps bus list data correctly after a tick", async () => {
      axios.get.mockResolvedValue({
        data: {
          msgHeader: { headerCd: "0" },
          msgBody: {
            itemList: [
              {
                stId: "100900197",
                staOrd: "1",
                stNm: "명륜새마을금고",
                plainNo1: "서울74사5537",
                mkTm: "2024-01-01 12:00:00",
                arsId: "01504",
                arrmsg1: "3분후[1번째 전]",
              },
            ],
          },
        },
      });

      await runTickAndFlush();

      const result = service.getJongroBusList("07");
      expect(result).toHaveLength(1);
      expect(result![0]).toMatchObject({
        stationId: "100900197",
        sequence: "1",
        stationName: "명륜새마을금고",
        carNumber: "5537",
        stationNumber: "01504",
        eta: "3분후[1번째 전]",
      });
    });

    it("extracts last 4 chars of plainNo1 as carNumber", async () => {
      axios.get.mockResolvedValue({
        data: {
          msgHeader: { headerCd: "0" },
          msgBody: {
            itemList: [
              {
                stId: "100900204",
                staOrd: "1",
                stNm: "성균관대학교",
                plainNo1: "서울74사1234",
                mkTm: "2024-01-01 12:00:00",
                arsId: "01881",
                arrmsg1: "곧 도착",
              },
            ],
          },
        },
      });

      await runTickAndFlush();

      const result07 = service.getJongroBusList("07");
      const result02 = service.getJongroBusList("02");
      const result = result07 && result07.length > 0 ? result07 : result02!;
      expect(result[0].carNumber).toBe("1234");
    });
  });

  describe("getJongroBusLocation", () => {
    it("maps location data with station mapping", async () => {
      axios.get.mockResolvedValue({
        data: {
          msgHeader: { headerCd: "0" },
          msgBody: {
            itemList: [
              {
                lastStnId: "100900197",
                tmX: "126.998",
                tmY: "37.587",
                plainNo: "서울74사5537",
              },
            ],
          },
        },
      });

      await runTickAndFlush();

      const result = service.getJongroBusLocation("07");
      expect(result).toHaveLength(1);
      // 명륜새마을금고 is TOPIS ord 6; the registry mirrors TOPIS order.
      expect(result![0]).toMatchObject({
        sequence: "6",
        stationName: "명륜새마을금고",
        carNumber: "5537",
        latitude: "37.587",
        longitude: "126.998",
      });
      expect(result![0].estimatedTime).toBeDefined();
    });
  });

  describe("registry drift warning", () => {
    const logger = require("../../../src/infra/logger");
    // What TOPIS would return when it matches the registry exactly: one row per
    // ord, including 02's loop-closing repeat of 성균관대학교 at ord 27.
    const topisListFor = (code: string) => {
      const route = jongroRoutes.find((r) => r.code === code)!;
      return route.topisIds.map((stId, idx) => ({
        stId,
        staOrd: String(idx + 1),
        stNm: route.stations[idx]!.stationName,
        arsId: "",
        plainNo1: "",
        mkTm: "",
        arrmsg1: "",
      }));
    };
    const driftWarnsFor = (code: string) =>
      (logger.warn as jest.Mock).mock.calls.filter(
        ([ctx, msg]) => ctx?.code === code && String(msg).includes("drifted"),
      );
    // axios returns the same body for every URL, so each case asserts only on
    // the route its list was built for; the other route is expected to warn.
    const respondWith = (itemList: unknown[]) =>
      axios.get.mockResolvedValue({
        data: { msgHeader: { headerCd: "0" }, msgBody: { itemList } },
      });

    it("stays quiet when TOPIS lists exactly the registry stops", async () => {
      respondWith(topisListFor("07"));
      await runTickAndFlush();
      expect(driftWarnsFor("07")).toHaveLength(0);
    });

    it("stays quiet on 02's loop-closing repeat of its first stop", async () => {
      respondWith(topisListFor("02"));
      await runTickAndFlush();
      expect(driftWarnsFor("02")).toHaveLength(0);
    });

    it("warns once, naming a stop TOPIS added", async () => {
      const list = topisListFor("07");
      const extra = { ...list[0]!, stId: "100000999", stNm: "새정류소", staOrd: "23" };
      respondWith([...list, extra]);
      await runTickAndFlush();
      await runTickAndFlush();
      const warns = driftWarnsFor("07");
      expect(warns).toHaveLength(1);
      expect(warns[0]![0]).toMatchObject({
        mismatched: [{ staOrd: "23", stId: "100000999", stNm: "새정류소", expected: null }],
        missing: [],
        renamed: [],
      });
    });

    it("names reordered stops by ord", async () => {
      const list = topisListFor("07");
      const [a, b] = [list[0]!, list[1]!];
      respondWith([{ ...b, staOrd: "1" }, { ...a, staOrd: "2" }, ...list.slice(2)]);
      await runTickAndFlush();
      expect(driftWarnsFor("07")[0]![0]).toMatchObject({
        mismatched: [
          { staOrd: "1", stId: b.stId, expected: a.stId },
          { staOrd: "2", stId: a.stId, expected: b.stId },
        ],
        missing: [],
      });
    });

    it("names registry ords that TOPIS no longer lists", async () => {
      respondWith(topisListFor("07").slice(0, -1));
      await runTickAndFlush();
      expect(driftWarnsFor("07")[0]![0]).toMatchObject({
        mismatched: [],
        missing: [{ staOrd: "22", topisId: "100900219", stationName: "600주년기념관" }],
      });
    });

    it("names renamed stops", async () => {
      const list = topisListFor("07");
      respondWith([{ ...list[0]!, stNm: "새이름" }, ...list.slice(1)]);
      await runTickAndFlush();
      expect(driftWarnsFor("07")[0]![0]).toMatchObject({
        mismatched: [],
        missing: [],
        renamed: [{ staOrd: "1", stNm: "새이름", registryName: "성균관대운동장" }],
      });
    });
  });

  describe("error handling", () => {
    it("rejects each route's tick on an API error; state stays undefined", async () => {
      axios.get.mockRejectedValue(new Error("Network error"));
      const outcomes = await runTickAndFlush();
      expect(outcomes.every((o) => o.status === "rejected")).toBe(true);
      expect(service.getJongroBusList("07")).toBeUndefined();
    });

    it("rejects on a TOPIS error code, carrying the code", async () => {
      axios.get.mockResolvedValue({
        data: { msgHeader: { headerCd: "7", headerMsg: "인증 실패" }, msgBody: { itemList: null } },
      });
      const [first] = await runTickAndFlush();
      expect(first).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ name: "UpstreamError", headerCd: "7" }),
      });
    });

    it("handles empty itemList → empty list array", async () => {
      axios.get.mockResolvedValue({
        data: { msgHeader: { headerCd: "0" }, msgBody: { itemList: [] } },
      });
      await runTickAndFlush();
      expect(service.getJongroBusList("07")).toHaveLength(0);
    });
  });
});
