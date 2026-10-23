/**
 * CalendarHolidaySyncPoller registers CalendarHolidaySyncService.run() with the poller registry
 * under name "holidays-sync" at config.holidays.syncIntervalMs (hourly, so a
 * failed sync retries within the hour; the service skips a year stored under
 * 24 hours ago, and the registry's warm-up run syncs at startup), and a
 * rejected sync reaches the
 * registry unchanged, so a failed sync is declared failing like any other
 * poller. The registry is a `registerPoller` spy (ADR 0011 D2) and the
 * service a stub, so neither the DB nor the calendar is touched. Whether a
 * process runs its pollers (ROLE) is the registry's.
 */
import config from "../../infra/config";
import type { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { CalendarHolidaySyncPoller } from "./calendar-holiday-sync.poller";
import type { CalendarHolidaySyncService } from "./calendar-holiday-sync.service";

const mockedSync = jest.fn<Promise<void>, []>();
const sync = { run: mockedSync } as unknown as CalendarHolidaySyncService;
const registerPoller = jest.fn<void, Parameters<PollerRegistryService["registerPoller"]>>();
const registry = { registerPoller } as unknown as PollerRegistryService;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("CalendarHolidaySyncPoller.onModuleInit", () => {
  it("registers a 'holidays-sync' poller once an hour", () => {
    // Act
    new CalendarHolidaySyncPoller(registry, sync).onModuleInit();

    // Assert
    expect(registerPoller).toHaveBeenCalledTimes(1);
    const [fn, intervalMs, name] = registerPoller.mock.calls[0]!;
    expect(intervalMs).toBe(config.holidays.syncIntervalMs);
    expect(intervalMs).toBe(60 * 60 * 1000);
    expect(name).toBe("holidays-sync");
    expect(typeof fn).toBe("function");
  });

  it("registered fn passes a sync rejection to the registry unchanged", async () => {
    // Arrange
    new CalendarHolidaySyncPoller(registry, sync).onModuleInit();
    const fn = registerPoller.mock.calls[0]![0];
    const syncError = new Error("getRestDeInfo: 2026: HTTP 500");
    mockedSync.mockRejectedValueOnce(syncError);

    // Act
    const outcome = Promise.resolve(fn());

    // Assert
    await expect(outcome).rejects.toBe(syncError);
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it("registered fn resolves on sync success", async () => {
    // Arrange
    new CalendarHolidaySyncPoller(registry, sync).onModuleInit();
    const fn = registerPoller.mock.calls[0]![0];
    mockedSync.mockResolvedValueOnce(undefined);

    // Act
    const outcome = Promise.resolve(fn());

    // Assert
    await expect(outcome).resolves.toBeUndefined();
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });
});
