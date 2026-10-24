/**
 * BusRoutePathPoller registers one daily poller per Jongro route, named
 * `jongro-path-<code>`, so one dead route does not mark the others down; a
 * tick is that route's sync and rejects with it. A regional route (7800) is
 * synced the same way with REGIONAL_BUS on, and not registered with it off.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import config from "../../infra/config";
import logger from "../../infra/logger";
import type { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { JONGRO_ROUTES } from "../bus.constants";
import { BusRoutePathPoller } from "./bus-route-path.poller";
import type { BusRoutePathService } from "./bus-route-path.service";

const jongroRoutes = JONGRO_ROUTES;
const regionalBus = config.regionalBus as { enabled: boolean };
const regionalBusEnabled = regionalBus.enabled;

const sync = jest.fn();
const registerPoller = jest.fn();
const registry = { registerPoller } as unknown as PollerRegistryService;
const routePaths = { sync } as unknown as BusRoutePathService;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  regionalBus.enabled = regionalBusEnabled;
});

describe("BusRoutePathPoller.onModuleInit", () => {
  it("registers one 24 h poller per route", () => {
    // Arrange
    regionalBus.enabled = false;

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

describe("BusRoutePathPoller.onModuleInit for the regional routes", () => {
  it("REGIONAL_BUS on syncs 7800's line daily as jongro-path-7800, after the Jongno routes", () => {
    // Arrange
    regionalBus.enabled = true;

    // Act
    new BusRoutePathPoller(registry, routePaths).onModuleInit();

    // Assert
    expect(registerPoller.mock.calls.map(([, intervalMs, name]) => [intervalMs, name])).toEqual([
      [86_400_000, "jongro-path-02"],
      [86_400_000, "jongro-path-07"],
      [86_400_000, "jongro-path-08"],
      [86_400_000, "jongro-path-7800"],
    ]);
  });

  it("REGIONAL_BUS=off registers no 7800 sync and says so once, naming it", () => {
    // Arrange
    regionalBus.enabled = false;

    // Act
    new BusRoutePathPoller(registry, routePaths).onModuleInit();

    // Assert
    expect(registerPoller).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith({ event: "bus.regional.disabled", poller: "jongro-path-7800" }, expect.any(String));
  });
});

