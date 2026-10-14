/**
 * BusRealtimeHsscPoller registers one 10 s poller named `hssc`, and its tick is
 * the service's refresh, so a failed tick rejects to the registry.
 */
import type { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import { BusRealtimeHsscPoller } from "./bus-realtime-hssc.poller";
import type { BusRealtimeHsscService } from "./bus-realtime-hssc.service";

const refresh = jest.fn();
const registerPoller = jest.fn();
const registry = { registerPoller } as unknown as PollerRegistryService;
const hssc = { refresh } as unknown as BusRealtimeHsscService;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BusRealtimeHsscPoller.onModuleInit", () => {
  it("registers a 10s 'hssc' poller", () => {
    // Act
    new BusRealtimeHsscPoller(registry, hssc).onModuleInit();

    // Assert
    expect(registerPoller).toHaveBeenCalledWith(expect.any(Function), 10000, "hssc");
  });

  it("rejects a tick when the refresh rejects", async () => {
    // Arrange
    refresh.mockRejectedValue(new Error("Network error"));
    new BusRealtimeHsscPoller(registry, hssc).onModuleInit();
    const tick = registerPoller.mock.calls[0]![0] as () => Promise<void>;

    // Act & Assert
    await expect(tick()).rejects.toThrow("Network error");
  });
});
