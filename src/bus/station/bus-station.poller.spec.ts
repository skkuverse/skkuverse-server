/**
 * BusStationPoller registers one 40 s poller named `station`, and its tick is
 * the service's refresh, so a failed tick rejects to the registry.
 */
import type { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { BusStationPoller } from "./bus-station.poller";
import type { BusStationService } from "./bus-station.service";

const refresh = jest.fn();
const registerPoller = jest.fn();
const registry = { registerPoller } as unknown as PollerRegistryService;
const station = { refresh } as unknown as BusStationService;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BusStationPoller.onModuleInit", () => {
  it("registers a 40s 'station' poller", () => {
    // Act
    new BusStationPoller(registry, station).onModuleInit();

    // Assert
    expect(registerPoller).toHaveBeenCalledWith(expect.any(Function), 40000, "station");
  });

  it("rejects a tick when the refresh rejects", async () => {
    // Arrange
    refresh.mockRejectedValue(new Error("TOPIS error code"));
    new BusStationPoller(registry, station).onModuleInit();
    const tick = registerPoller.mock.calls[0]![0] as () => Promise<void>;

    // Act & Assert
    await expect(tick()).rejects.toThrow("TOPIS error code");
  });
});
