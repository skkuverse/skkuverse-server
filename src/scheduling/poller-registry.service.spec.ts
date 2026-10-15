/**
 * Exercises PollerRegistryService directly.
 *
 * Strategy:
 *   - the logger and Sentry are mocked, so the state-transition lines (failing,
 *     still failing, recovered), the one Issue per failing spell and the cron
 *     check-ins can be asserted.
 *   - Fake timers drive setInterval deterministically.
 *   - A fresh service is constructed per test (no module-scoped state to reset
 *     — the registry/intervalIds live on the instance).
 *
 * Plus two Nest-specific checks the spec pins: the onApplicationBootstrap
 * ROLE-gating (ROLE=api → no startAll) and onApplicationShutdown → stopAll.
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

import { inspect } from "node:util";
import { PollerRegistryService } from "./poller-registry.service";

const logger = require("../infra/logger");
const Sentry = require("@sentry/nestjs");

/** Lets the settled tick's outcome handlers run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const events = (mock: jest.Mock): string[] =>
  mock.mock.calls.map(([fields]) => (fields as { event: string }).event);

describe("PollerRegistryService", () => {
  let registry: PollerRegistryService;

  beforeEach(() => {
    jest.useFakeTimers();
    registry = new PollerRegistryService();
  });

  afterEach(() => {
    registry.stopAll();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("startAll", () => {
    it("no-op when nothing is registered", () => {
      // Act
      registry.startAll();

      // Assert
      expect(registry.isReady()).toBe(false);
    });

    it("runs each fn once immediately as warm-up", () => {
      // Arrange
      const fn1 = jest.fn();
      const fn2 = jest.fn();
      registry.registerPoller(fn1, 1000, "a");
      registry.registerPoller(fn2, 2000, "b");

      // Act
      registry.startAll();

      // Assert
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
    });

    it("registers a setInterval per poller and ticks at the configured interval", async () => {
      // Arrange
      const fn1 = jest.fn();
      const fn2 = jest.fn();
      registry.registerPoller(fn1, 1000, "a");
      registry.registerPoller(fn2, 2500, "b");

      // Act
      registry.startAll();
      // Flush warm-up's Promise.resolve(...).catch(...).finally(...) chain
      // (two microtasks) so inFlight is cleared before the timer advances.
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      // Assert
      expect(fn1).toHaveBeenCalledTimes(2);
      expect(fn2).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
      expect(fn1).toHaveBeenCalledTimes(3);
      expect(fn2).toHaveBeenCalledTimes(2);
    });
  });

  describe("in-flight guard", () => {
    it("skips ticks while a previous run is still pending and warns", async () => {
      // Arrange
      let resolveFn: () => void;
      const pending = new Promise<void>((r) => {
        resolveFn = r;
      });
      const fn = jest.fn(() => pending);
      registry.registerPoller(fn, 1000, "slow");

      // Act
      registry.startAll();

      // Assert
      expect(fn).toHaveBeenCalledTimes(1); // warm-up

      jest.advanceTimersByTime(3000); // 3 ticks while still pending
      expect(fn).toHaveBeenCalledTimes(1);
      // A skipped tick is routine for a slow upstream: debug, not warn.
      expect(logger.debug).toHaveBeenCalledWith(
        { event: "poller.skipped_in_flight", name: "slow" },
        "Poller skipped: previous run still in flight",
      );
      expect(logger.debug).toHaveBeenCalledTimes(3);
      expect(logger.warn).not.toHaveBeenCalled();

      resolveFn!();
      await Promise.resolve();
      await Promise.resolve();

      jest.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("resets inFlight after fn rejects and allows the next tick", async () => {
      // Arrange
      let calls = 0;
      const fn = jest.fn(() => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error("boom")) : Promise.resolve();
      });
      registry.registerPoller(fn, 1000, "flaky");

      // Act
      registry.startAll();
      await settle();
      jest.advanceTimersByTime(1000);
      await settle();

      // Assert
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("failure state transitions", () => {
    it("declares a fast poller failing on its third failure in a row, once", async () => {
      // Arrange
      const fn = jest.fn(() => Promise.reject(new Error("upstream down")));
      registry.registerPoller(fn, 1000, "fast");

      // Act
      registry.startAll();
      await settle();
      for (let i = 0; i < 4; i++) {
        jest.advanceTimersByTime(1000);
        await settle();
      }

      // Assert
      // Ticks 1–2: debug only. Tick 3: one error line and one Issue. 4–5: quiet.
      expect(events(logger.error)).toEqual(["poller.failing"]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ name: "fast", failures: 3 }),
        "Poller failing",
      );
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { poller: "fast" },
      });
      expect(events(logger.debug).filter((e) => e === "poller.tick_failed")).toHaveLength(4);
      expect(registry.failingPollers()).toEqual(["fast"]);
    });

    it("lets a single failed tick pass without an error line", async () => {
      // Arrange
      let calls = 0;
      const fn = jest.fn(() => (++calls === 1 ? Promise.reject(new Error("blip")) : undefined));
      registry.registerPoller(fn, 1000, "blippy");

      // Act
      registry.startAll();
      await settle();
      jest.advanceTimersByTime(1000);
      await settle();

      // Assert
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info.mock.calls.map(([f]: [{ event: string }]) => f.event)).not.toContain(
        "poller.recovered",
      );
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it("declares a slow poller on its first failure, and logs its recovery", async () => {
      // Arrange
      let calls = 0;
      const fn = jest.fn(() => (++calls === 1 ? Promise.reject(new Error("sweep failed")) : undefined));
      registry.registerPoller(fn, 60_000, "slow");

      // Act
      registry.startAll();
      await settle();

      // Assert
      expect(events(logger.error)).toEqual(["poller.failing"]);

      jest.advanceTimersByTime(60_000);
      await settle();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: "poller.recovered", name: "slow", failures: 1 }),
        "Poller recovered",
      );
      expect(registry.failingPollers()).toEqual([]);
    });

    it("counts a synchronous throw as a failure", async () => {
      // Arrange
      registry.registerPoller(
        () => {
          throw new Error("sync");
        },
        60_000,
        "thrower",
      );

      // Act
      registry.startAll();
      await settle();

      // Assert
      expect(events(logger.error)).toEqual(["poller.failing"]);
    });

    it("reminds every 15 minutes while a poller stays down", async () => {
      // Arrange
      registry.registerPoller(() => Promise.reject(new Error("down")), 60_000, "down");

      // Act
      registry.startAll();
      await settle();
      for (let i = 0; i < 16; i++) {
        jest.advanceTimersByTime(60_000);
        await settle();
      }

      // Assert
      expect(events(logger.warn)).toEqual(["poller.still_failing"]);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("Sentry cron heartbeat", () => {
    const WEEK_MS = 7 * 24 * 60 * 60_000;

    /** Advances one interval at a time, letting each tick's outcome settle. */
    async function tick(intervalMs: number, times: number): Promise<void> {
      for (let i = 0; i < times; i++) {
        jest.advanceTimersByTime(intervalMs);
        await settle();
      }
    }

    it("checks in ok every 5 minutes, and error while a fast poller is failing", async () => {
      // Arrange
      let failing = false;
      registry.registerPoller(
        () => (failing ? Promise.reject(new Error("x")) : undefined),
        10_000,
        "p",
      );

      // Act
      registry.startAll();
      await settle();
      await tick(10_000, 30);

      // Assert
      expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
        { monitorSlug: "skkuverse-pollers", status: "ok" },
        expect.objectContaining({ schedule: { type: "interval", value: 5, unit: "minute" } }),
      );

      failing = true;
      await tick(10_000, 30);
      expect(registry.failingPollers()).toEqual(["p"]);
      expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
        { monitorSlug: "skkuverse-pollers", status: "error" },
        expect.anything(),
      );
    });

    it("checks in ok while only a slow poller is failing, which still reports through its own Issue", async () => {
      // Arrange
      registry.registerPoller(() => Promise.reject(new Error("crawl failed")), WEEK_MS, "weekly");

      // Act
      registry.startAll();
      await settle();
      await tick(60_000, 5);

      // Assert
      expect(registry.failingPollers()).toEqual(["weekly"]);
      expect(events(logger.error)).toEqual(["poller.failing"]);
      expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { poller: "weekly" },
      });
      expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
        { monitorSlug: "skkuverse-pollers", status: "ok" },
        expect.anything(),
      );
    });

    it("checks in error when a slow and a fast poller are both failing", async () => {
      // Arrange
      registry.registerPoller(() => Promise.reject(new Error("crawl failed")), WEEK_MS, "weekly");
      registry.registerPoller(() => Promise.reject(new Error("upstream down")), 10_000, "fast");

      // Act
      registry.startAll();
      await settle();
      await tick(10_000, 30);

      // Assert
      expect(registry.failingPollers()).toEqual(["weekly", "fast"]);
      expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
        { monitorSlug: "skkuverse-pollers", status: "error" },
        expect.anything(),
      );
    });

    it("stops checking in after stopAll", () => {
      // Arrange
      registry.registerPoller(jest.fn(), 60_000, "p");

      // Act
      registry.startAll();
      registry.stopAll();
      jest.advanceTimersByTime(10 * 60_000);

      // Assert
      expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
    });
  });

  // (An operations detail is left out of the public history.)
  describe("Healthchecks.io heartbeat ping", () => {
    const PING_URL = "https://hc-ping.com/0f0e0d0c-test-ping-uuid";
    const HEARTBEAT_MS = 5 * 60_000;
    const realFetch = global.fetch;
    const realSetImmediate = setImmediate;
    let fetchMock: jest.Mock;
    let savedUrl: string | undefined;

    async function tick(intervalMs: number, times: number): Promise<void> {
      for (let i = 0; i < times; i++) {
        jest.advanceTimersByTime(intervalMs);
        await settle();
      }
    }

    function withPingUrl(url: string | undefined): void {
      if (url === undefined) delete process.env.HEALTHCHECKS_POLLER_PING_URL;
      else process.env.HEALTHCHECKS_POLLER_PING_URL = url;
    }

    beforeEach(() => {
      savedUrl = process.env.HEALTHCHECKS_POLLER_PING_URL;
      withPingUrl(PING_URL);
      fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
      global.fetch = realFetch;
      withPingUrl(savedUrl);
    });

    it("pings the check once for every ok check-in", async () => {
      // Arrange
      registry.registerPoller(jest.fn(), 10_000, "p");

      // Act
      registry.startAll();
      await settle();
      await tick(HEARTBEAT_MS, 3);

      // Assert
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.every(([url]) => url === PING_URL)).toBe(true);
    });

    it("does not ping while a fast poller is declared failing, and pings again once it recovers", async () => {
      // Arrange
      let failing = true;
      registry.registerPoller(
        () => (failing ? Promise.reject(new Error("upstream down")) : undefined),
        10_000,
        "fast",
      );

      // Act
      registry.startAll();
      await settle();
      await tick(10_000, 30);

      // Assert
      expect(registry.failingPollers()).toEqual(["fast"]);
      expect(fetchMock).not.toHaveBeenCalled();

      failing = false;
      await tick(10_000, 30);
      expect(fetchMock).toHaveBeenCalled();
    });

    it("does not ping at all when no ping URL is set", async () => {
      // Arrange
      withPingUrl(undefined);
      registry.registerPoller(jest.fn(), 10_000, "p");

      // Act
      registry.startAll();
      await settle();
      await tick(HEARTBEAT_MS, 2);

      // Assert
      expect(Sentry.captureCheckIn).toHaveBeenCalledTimes(2);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("gives up on a ping that hangs within ten seconds", async () => {
      // Arrange
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise(() => {});
      });
      registry.registerPoller(jest.fn(), 60_000, "p");

      // Act
      registry.startAll();
      await settle();
      await tick(HEARTBEAT_MS, 1);
      await tick(10_000, 1);

      // Assert
      expect(signal?.aborted).toBe(true);
    });

    it.each([
      ["rejects", () => Promise.reject(new Error(`request to ${PING_URL} failed, reason: ECONNRESET`))],
      ["answers 500", () => Promise.resolve(new Response(null, { status: 500 }))],
    ])("keeps the pollers and check-ins going when the ping %s, and never logs the URL", async (_label, answer) => {
      // Arrange
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);
      fetchMock.mockImplementation(answer);
      const fn = jest.fn();
      registry.registerPoller(fn, 60_000, "p");

      try {
        // Act
        registry.startAll();
        await settle();
        // One poller interval at a time: a single 5-minute jump fires ticks the in-flight guard skips.
        await tick(60_000, 10);
        // A real macrotask, so Node has reported any unhandled rejection before the assertions.
        await new Promise((resolve) => realSetImmediate(resolve));

        // Assert
        expect(unhandled).toEqual([]);
        expect(Sentry.captureCheckIn).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenCalledTimes(11);
        expect(events(logger.warn)).toContain("poller.healthchecks_ping_failed");
        const logged = [logger.info, logger.warn, logger.error, logger.debug]
          .map((m: jest.Mock) => inspect(m.mock.calls, { depth: 8 }))
          .join("\n");
        expect(logged).not.toContain("test-ping-uuid");
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  });

  describe("stopAll", () => {
    it("clears all intervals so no further ticks fire", () => {
      // Arrange
      const fn = jest.fn();
      registry.registerPoller(fn, 1000, "stop");

      // Act
      registry.startAll();

      // Assert
      expect(fn).toHaveBeenCalledTimes(1);

      registry.stopAll();
      jest.advanceTimersByTime(5000);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("is idempotent", () => {
      // Arrange
      registry.registerPoller(jest.fn(), 1000, "idem");
      registry.startAll();
      registry.stopAll();

      // Act & Assert
      expect(() => registry.stopAll()).not.toThrow();
    });
  });

  describe("isReady", () => {
    it("is false before startAll, even when pollers are registered", () => {
      // Arrange
      registry.registerPoller(jest.fn(), 1000, "r");

      // Act & Assert
      expect(registry.isReady()).toBe(false);
    });

    it("is true after startAll when at least one poller is registered", () => {
      // Arrange
      registry.registerPoller(jest.fn(), 1000, "r");

      // Act
      registry.startAll();

      // Assert
      expect(registry.isReady()).toBe(true);
    });

    it("is false after stopAll", () => {
      // Arrange
      registry.registerPoller(jest.fn(), 1000, "r");

      // Act
      registry.startAll();
      registry.stopAll();

      // Assert
      expect(registry.isReady()).toBe(false);
    });

    it("is true only when all registered pollers have a live interval", () => {
      // Arrange
      registry.registerPoller(jest.fn(), 1000, "a");
      registry.registerPoller(jest.fn(), 1000, "b");
      registry.registerPoller(jest.fn(), 1000, "c");

      // Act
      registry.startAll();

      // Assert
      // 3 registered → 3 intervals → ready
      expect(registry.isReady()).toBe(true);
    });
  });

  describe("Nest lifecycle hooks", () => {
    it("onApplicationBootstrap starts pollers when ROLE !== 'api' (combined)", () => {
      // Arrange
      const prev = process.env.ROLE;
      delete process.env.ROLE; // → "combined"
      registry.registerPoller(jest.fn(), 1000, "x");

      // Act
      registry.onApplicationBootstrap();

      // Assert
      expect(registry.isReady()).toBe(true);
      if (prev === undefined) delete process.env.ROLE;
      else process.env.ROLE = prev;
    });

    it("onApplicationBootstrap does NOT start pollers under ROLE=api", () => {
      // Arrange
      const prev = process.env.ROLE;
      process.env.ROLE = "api";
      registry.registerPoller(jest.fn(), 1000, "x");

      // Act
      registry.onApplicationBootstrap();

      // Assert
      expect(registry.isReady()).toBe(false);
      if (prev === undefined) delete process.env.ROLE;
      else process.env.ROLE = prev;
    });

    it("onApplicationShutdown stops all pollers", () => {
      // Arrange
      registry.registerPoller(jest.fn(), 1000, "x");
      registry.startAll();
      expect(registry.isReady()).toBe(true);

      // Act
      registry.onApplicationShutdown();

      // Assert
      expect(registry.isReady()).toBe(false);
    });
  });
});
