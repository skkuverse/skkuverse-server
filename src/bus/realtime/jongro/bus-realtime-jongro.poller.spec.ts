/**
 * BusRealtimeJongroPoller registers one 25 s poller per registry route, named
 * `jongro-<code>`, so one dead route does not mark the others down; a tick is
 * that route's refresh and rejects with it. A regional route (7800) is polled
 * every 30 s after them with REGIONAL_BUS on, and with it off is not
 * registered, which the poller says once per route.
 */
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import config from "../../../infra/config";
import logger from "../../../infra/logger";
import type { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import { JONGRO_ROUTES } from "../../bus.constants";
import { BusRealtimeJongroPoller } from "./bus-realtime-jongro.poller";
import type { BusRealtimeJongroService } from "./bus-realtime-jongro.service";

const jongroRoutes = JONGRO_ROUTES;
const regionalBus = config.regionalBus as { enabled: boolean };
const regionalBusEnabled = regionalBus.enabled;

const refresh = jest.fn();
const registerPoller = jest.fn();
const registry = { registerPoller } as unknown as PollerRegistryService;
const jongro = { refresh } as unknown as BusRealtimeJongroService;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  regionalBus.enabled = regionalBusEnabled;
});

describe("BusRealtimeJongroPoller.onModuleInit", () => {
  it("onModuleInit registers one 25s poller per route", () => {
    // Arrange
    regionalBus.enabled = false;

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

describe("BusRealtimeJongroPoller.onModuleInit for the regional routes", () => {
  it("REGIONAL_BUS on registers 7800 as jongro-7800 every 30 s, after the Jongno routes", () => {
    // Arrange
    regionalBus.enabled = true;

    // Act
    new BusRealtimeJongroPoller(registry, jongro).onModuleInit();

    // Assert
    expect(registerPoller.mock.calls.map(([, intervalMs, name]) => [name, intervalMs])).toEqual([
      ["jongro-02", 25_000],
      ["jongro-07", 25_000],
      ["jongro-08", 25_000],
      ["jongro-7800", 30_000],
    ]);
  });

  it("REGIONAL_BUS=off registers no 7800 poller and says so once, naming it", () => {
    // Arrange
    regionalBus.enabled = false;

    // Act
    new BusRealtimeJongroPoller(registry, jongro).onModuleInit();

    // Assert
    expect(registerPoller.mock.calls.map(([, , name]) => name)).toEqual(["jongro-02", "jongro-07", "jongro-08"]);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ event: "bus.regional.disabled", poller: "jongro-7800" }, expect.any(String));
  });

  it("ticks the 7800 refresh, which rejects with it", async () => {
    // Arrange
    regionalBus.enabled = true;
    refresh.mockRejectedValue(new Error("TOPIS error code (jongro 7800 list)"));
    new BusRealtimeJongroPoller(registry, jongro).onModuleInit();
    const tick = registerPoller.mock.calls[3]![0] as () => Promise<void>;

    // Act & Assert
    await expect(tick()).rejects.toThrow("jongro 7800 list");
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ id: "gyeonggi7800", busRouteId: "200000150" }));
  });
});
