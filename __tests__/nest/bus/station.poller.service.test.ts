/**
 * StationPollerService — the Hyehwa station arrival message.
 *
 * Pins what counts as a failed tick. TOPIS answers "4" (no result) for this
 * stop in every sample collected so far; that must keep the previous message
 * and NOT count as a failure, or the poller would be declared failing forever.
 * Any other error code, or a body without an itemList, rejects.
 */
jest.mock("axios", () => ({ get: jest.fn() }));

import { StationPollerService } from "../../../src/bus/fetchers/station.poller.service";
import type { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";
import type { BusCacheService } from "../../../src/bus/cache/bus-cache.service";

const axios = require("axios");

let tick: () => Promise<unknown>;
const registryStub = {
  registerPoller: jest.fn((fn: () => Promise<unknown>) => {
    tick = fn;
  }),
} as unknown as PollerRegistryService;
const cacheStub = { write: jest.fn().mockResolvedValue(undefined) } as unknown as BusCacheService;

let service: StationPollerService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new StationPollerService(registryStub, cacheStub);
  service.onModuleInit();
});

const respond = (data: unknown) => axios.get.mockResolvedValue({ data });

describe("StationPollerService", () => {
  it("registers a 40s 'station' poller", () => {
    expect(registryStub.registerPoller).toHaveBeenCalledWith(expect.any(Function), 40000, "station");
  });

  it("serves the first item's message and mirrors it to bus_cache", async () => {
    respond({ msgHeader: { headerCd: "0" }, msgBody: { itemList: [{ arrmsg1: "3분후[1번째 전]" }] } });
    await tick();
    expect(service.getStationInfo()).toBe("3분후[1번째 전]");
    expect(cacheStub.write).toHaveBeenCalledWith("station", "3분후[1번째 전]");
  });

  it("treats headerCd 4 (no result) as a quiet success that keeps the message", async () => {
    respond({ msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." }, msgBody: { itemList: null } });
    await expect(tick()).resolves.toBeUndefined();
    expect(service.getStationInfo()).toBe("정보 없음");
    expect(cacheStub.write).not.toHaveBeenCalled();
  });

  it("rejects any other TOPIS code with the code attached", async () => {
    respond({ msgHeader: { headerCd: "7", headerMsg: "인증 실패" }, msgBody: { itemList: null } });
    await expect(tick()).rejects.toMatchObject({ name: "UpstreamError", headerCd: "7" });
  });

  it("rejects a body with no itemList and no header", async () => {
    respond({});
    await expect(tick()).rejects.toThrow(/no itemList/);
  });
});
