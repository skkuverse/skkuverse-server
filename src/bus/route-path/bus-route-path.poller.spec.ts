/**
 * BusRoutePathPoller registers one daily poller per Jongro route, named
 * `jongro-path-<code>`, so one dead route does not mark the others down; a
 * tick is that route's sync and rejects with it.
 */
import type { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { JONGRO_ROUTES } from "../bus.constants";
import { BusRoutePathPoller } from "./bus-route-path.poller";
import type { BusRoutePathService } from "./bus-route-path.service";

const jongroRoutes = JONGRO_ROUTES;

const sync = jest.fn();
const registerPoller = jest.fn();
const registry = { registerPoller } as unknown as PollerRegistryService;
const routePaths = { sync } as unknown as BusRoutePathService;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BusRoutePathPoller.onModuleInit", () => {
  it("registers one 24 h poller per route", () => {
    // Act
    new BusRoutePathPoller(registry, routePaths).onModuleInit();

    // Assert
    expect(registerPoller.mock.calls.map(([, intervalMs, name]) => [intervalMs, name])).toEqual([
      [86_400_000, "jongro-path-02"],
      [86_400_000, "jongro-path-07"],
      [86_400_000, "jongro-path-08"],
    ]);
  });

  it("ticks sync their own route and reject with it", async () => {
    // Arrange
    sync.mockRejectedValue(new Error("TOPIS request failed"));
    new BusRoutePathPoller(registry, routePaths).onModuleInit();
    const tick = registerPoller.mock.calls[2]![0] as () => Promise<void>;

    // Act & Assert
    await expect(tick()).rejects.toThrow("TOPIS request failed");
    expect(sync).toHaveBeenCalledWith(jongroRoutes[2]);
  });
});
