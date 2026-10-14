/**
 * BusRealtimeHsscClient over a mocked axios: the HSSC API answers a bare
 * array, handed back as it comes; any other body rejects as an UpstreamError
 * so the poller registry counts the tick as failed.
 */
jest.mock("axios", () => ({ get: jest.fn() }));

import { BusRealtimeHsscClient } from "./bus-realtime-hssc.client";

const axios = require("axios") as { get: jest.Mock };

const ROW = { line_no: "1", inout: "LEFT", stop_no: "3", seq: "6", stop_name: "농구장정류소", get_date: "2026-10-20 오전 9:59:30" };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BusRealtimeHsscClient.fetchBuses", () => {
  it("returns the rows of an array body, with a 10 s timeout", async () => {
    // Arrange
    axios.get.mockResolvedValue({ data: [ROW] });

    // Act
    const buses = await new BusRealtimeHsscClient().fetchBuses();

    // Assert
    expect(buses).toEqual([ROW]);
    expect(axios.get).toHaveBeenCalledWith(expect.any(String), { timeout: 10000 });
  });

  it("returns an empty array when no bus is running", async () => {
    // Arrange
    axios.get.mockResolvedValue({ data: [] });

    // Act & Assert
    expect(await new BusRealtimeHsscClient().fetchBuses()).toEqual([]);
  });

  it("rejects a non-array response shape", async () => {
    // Arrange
    axios.get.mockResolvedValue({ data: { unexpected: true } });

    // Act & Assert
    await expect(new BusRealtimeHsscClient().fetchBuses()).rejects.toThrow(/not an array/);
    await expect(new BusRealtimeHsscClient().fetchBuses()).rejects.toMatchObject({ name: "UpstreamError", upstream: "hssc" });
  });

  it("rejects on a network error", async () => {
    // Arrange
    axios.get.mockRejectedValue(new Error("Network error"));

    // Act & Assert
    await expect(new BusRealtimeHsscClient().fetchBuses()).rejects.toThrow("Network error");
  });
});
