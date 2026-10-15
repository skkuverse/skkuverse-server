/**
 * BusStationClient — the Hyehwa stop's arrival messages from TOPIS.
 *
 * Pins what counts as a failed tick. TOPIS answers "4" (no result) for this
 * stop in every sample collected so far; that must read as no arrival (an
 * empty list, which the tick still writes) and NOT reject, or the poller
 * would be declared failing forever. Any other error code, or a body without an
 * itemList, rejects.
 */
jest.mock("axios", () => ({ get: jest.fn() }));

import { BusStationClient } from "./bus-station.client";

const axios = require("axios") as { get: jest.Mock };

const respond = (data: unknown) => axios.get.mockResolvedValue({ data });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BusStationClient.fetchArrivalMessages", () => {
  it("returns each row's first message", async () => {
    // Arrange
    respond({ msgHeader: { headerCd: "0" }, msgBody: { itemList: [{ arrmsg1: "3분후[1번째 전]" }] } });

    // Act & Assert
    expect(await new BusStationClient().fetchArrivalMessages()).toEqual(["3분후[1번째 전]"]);
    expect(axios.get).toHaveBeenCalledWith(expect.any(String), { timeout: 10000 });
  });

  it("treats headerCd 4 (no result) as a quiet success with no message", async () => {
    // Arrange
    respond({ msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." }, msgBody: { itemList: null } });

    // Act & Assert
    await expect(new BusStationClient().fetchArrivalMessages()).resolves.toEqual([]);
  });

  it("rejects any other TOPIS code with the code attached", async () => {
    // Arrange
    respond({ msgHeader: { headerCd: "7", headerMsg: "인증 실패" }, msgBody: { itemList: null } });

    // Act & Assert
    await expect(new BusStationClient().fetchArrivalMessages()).rejects.toMatchObject({ name: "UpstreamError", headerCd: "7" });
  });

  it("rejects a body with no itemList and no header", async () => {
    // Arrange
    respond({});

    // Act & Assert
    await expect(new BusStationClient().fetchArrivalMessages()).rejects.toThrow(/no itemList/);
  });
});
