/**
 * BusRealtimeGbisPoller registers one 90 s poller per regional route, `gbis-seats-7800`, with GBIS on, and nothing
 * with it off, saying so once per poller; its tick is the service's refresh of that route, so a failed tick rejects
 * to the registry.
 */
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import config from "../../../infra/config";
import logger from "../../../infra/logger";
import type { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import { REGIONAL_ROUTES } from "../../bus.constants";
import { BusRealtimeGbisPoller } from "./bus-realtime-gbis.poller";
import type { BusRealtimeGbisService } from "./bus-realtime-gbis.service";

const gbis = config.gbis as { enabled: boolean };
const refresh = jest.fn();
const registerPoller = jest.fn();
const registry = { registerPoller } as unknown as PollerRegistryService;
const seats = { refresh } as unknown as BusRealtimeGbisService;

describe("BusRealtimeGbisPoller.onModuleInit", () => {
  const enabled = gbis.enabled;
  afterEach(() => {
    gbis.enabled = enabled;
    jest.clearAllMocks();
  });

  it("registers a 90 s 'gbis-seats-7800' poller with GBIS on", () => {
    // Arrange
    gbis.enabled = true;

    // Act
    new BusRealtimeGbisPoller(registry, seats).onModuleInit();

    // Assert
    expect(registerPoller.mock.calls.map((call) => [call[2], call[1]])).toEqual([["gbis-seats-7800", 90_000]]);
  });

  it("GBIS=off registers nothing and says so once, naming the poller", () => {
    // Arrange
    gbis.enabled = false;

    // Act
    new BusRealtimeGbisPoller(registry, seats).onModuleInit();

    // Assert
    expect(registerPoller).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ event: "bus.gbis.disabled", poller: "gbis-seats-7800" }, expect.any(String));
  });

  it("ticks the route's refresh, and rejects when it rejects", async () => {
    // Arrange
    gbis.enabled = true;
    refresh.mockRejectedValue(new Error("GBIS daily quota exceeded (7800 seats)"));
    new BusRealtimeGbisPoller(registry, seats).onModuleInit();
    const tick = registerPoller.mock.calls[0]![0] as () => Promise<void>;

    // Act & Assert
    await expect(tick()).rejects.toThrow("GBIS daily quota exceeded");
    expect(refresh).toHaveBeenCalledWith(REGIONAL_ROUTES[0]);
  });
});
