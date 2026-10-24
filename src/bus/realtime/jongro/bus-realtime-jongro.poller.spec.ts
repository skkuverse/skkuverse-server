/**
 * BusRealtimeJongroPoller registers one 25 s poller per registry route, named
 * `jongro-<code>`, so one dead route does not mark the others down; a tick is
 * that route's refresh and rejects with it.
 */
import type { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import { JONGRO_ROUTES } from "../../bus.constants";
import { BusRealtimeJongroPoller } from "./bus-realtime-jongro.poller";
import type { BusRealtimeJongroService } from "./bus-realtime-jongro.service";

const jongroRoutes = JONGRO_ROUTES;

const refresh = jest.fn();
const registerPoller = jest.fn();
const registry = { registerPoller } as unknown as PollerRegistryService;
const jongro = { refresh } as unknown as BusRealtimeJongroService;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BusRealtimeJongroPoller.onModuleInit", () => {
  it("onModuleInit registers one 25s poller per route", () => {
    // Act
    new BusRealtimeJongroPoller(registry, jongro).onModuleInit();

    // Assert
    for (const route of jongroRoutes) {
      expect(registerPoller).toHaveBeenCalledWith(expect.any(Function), 25000, `jongro-${route.code}`);
    }
    expect(registerPoller).toHaveBeenCalledTimes(jongroRoutes.length);
  });

  it("ticks refresh their own route and reject with it", async () => {
    // Arrange
    refresh.mockRejectedValue(new Error("Network error"));
    new BusRealtimeJongroPoller(registry, jongro).onModuleInit();
    const tick = registerPoller.mock.calls[1]![0] as () => Promise<void>;

    // Act & Assert
    await expect(tick()).rejects.toThrow("Network error");
    expect(refresh).toHaveBeenCalledWith(jongroRoutes[1]);
  });
});
