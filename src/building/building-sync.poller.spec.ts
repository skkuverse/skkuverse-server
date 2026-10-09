/**
 * BuildingSyncPoller registers BuildingSyncService.run() with the Nest
 * PollerRegistry under name "building-sync" at the configured interval, and a
 * rejected run reaches the registry unchanged, so a failed sync is declared
 * failing like any other poller. The sync service is a stub, so neither the DB
 * nor the SKKU API is touched; the logger and Sentry are mocked for the
 * registry.
 */
jest.mock("../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock("@sentry/nestjs", () => ({
  captureException: jest.fn(),
  captureCheckIn: jest.fn(),
}));

import config from "../infra/config";
import { BuildingSyncPoller } from "./building-sync.poller";
import type { BuildingSyncService } from "./building-sync.service";
import { PollerRegistryService } from "../scheduling/poller-registry.service";

const mockedSync = jest.fn<Promise<void>, []>();
const sync = { run: mockedSync } as unknown as BuildingSyncService;

/** Lets the registry's outcome handlers for the warm-up run settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

let registry: PollerRegistryService;

beforeEach(() => {
  jest.clearAllMocks();
  registry = new PollerRegistryService();
});

afterEach(() => {
  registry.stopAll();
});

describe("BuildingSyncPoller.onModuleInit", () => {
  it("registers a 'building-sync' poller at config.building.syncIntervalMs", () => {
    const spy = jest.spyOn(registry, "registerPoller");

    new BuildingSyncPoller(registry, sync).onModuleInit();

    expect(spy).toHaveBeenCalledTimes(1);
    const [fn, intervalMs, name] = spy.mock.calls[0]!;
    expect(intervalMs).toBe(config.building.syncIntervalMs);
    expect(name).toBe("building-sync");
    expect(typeof fn).toBe("function");
  });

  it("registered fn passes a sync rejection to the registry unchanged", async () => {
    const spy = jest.spyOn(registry, "registerPoller");
    new BuildingSyncPoller(registry, sync).onModuleInit();
    const fn = spy.mock.calls[0]![0];
    const syncError = new AggregateError([new Error("crawl failed")], "phase 1 failed");
    mockedSync.mockRejectedValueOnce(syncError);

    const outcome = Promise.resolve(fn());

    await expect(outcome).rejects.toBe(syncError);
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it("registers nothing when BUILDING_SYNC resolved to off (the development default)", () => {
    const saved = config.building.syncEnabled;
    config.building.syncEnabled = false;
    try {
      const spy = jest.spyOn(registry, "registerPoller");
      new BuildingSyncPoller(registry, sync).onModuleInit();
      expect(spy).not.toHaveBeenCalled();
      expect(mockedSync).not.toHaveBeenCalled();
    } finally {
      config.building.syncEnabled = saved;
    }
  });

  it("registered fn resolves on sync success", async () => {
    const spy = jest.spyOn(registry, "registerPoller");
    new BuildingSyncPoller(registry, sync).onModuleInit();
    const fn = spy.mock.calls[0]![0];
    mockedSync.mockResolvedValueOnce(undefined);

    const outcome = Promise.resolve(fn());

    await expect(outcome).resolves.toBeUndefined();
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it("a failed sync makes the registry declare 'building-sync' failing", async () => {
    new BuildingSyncPoller(registry, sync).onModuleInit();
    mockedSync.mockRejectedValueOnce(new Error("crawl failed"));

    registry.startAll();
    await settle();

    expect(registry.failingPollers()).toEqual(["building-sync"]);
  });
});
