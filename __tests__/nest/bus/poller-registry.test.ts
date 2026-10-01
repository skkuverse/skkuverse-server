/**
 * Nest port of pollers.test.ts — exercises PollerRegistryService directly.
 *
 * Strategy mirrors the Express test:
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

jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock("@sentry/nestjs", () => ({
  captureException: jest.fn(),
  captureCheckIn: jest.fn(),
}));

import { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";

const logger = require("../../../src/infra/logger");
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
      registry.startAll();
      expect(registry.isReady()).toBe(false);
    });

    it("runs each fn once immediately as warm-up", () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();
      registry.registerPoller(fn1, 1000, "a");
      registry.registerPoller(fn2, 2000, "b");
      registry.startAll();
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
    });

    it("registers a setInterval per poller and ticks at the configured interval", async () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();
      registry.registerPoller(fn1, 1000, "a");
      registry.registerPoller(fn2, 2500, "b");
      registry.startAll();
      // Flush warm-up's Promise.resolve(...).catch(...).finally(...) chain
      // (two microtasks) so inFlight is cleared before the timer advances.
      await Promise.resolve();
      await Promise.resolve();

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
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
      let resolveFn: () => void;
      const pending = new Promise<void>((r) => {
        resolveFn = r;
      });
      const fn = jest.fn(() => pending);
      registry.registerPoller(fn, 1000, "slow");
      registry.startAll();
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
      let calls = 0;
      const fn = jest.fn(() => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error("boom")) : Promise.resolve();
      });
      registry.registerPoller(fn, 1000, "flaky");
      registry.startAll();
      await settle();

      jest.advanceTimersByTime(1000);
      await settle();
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("failure state transitions", () => {
    it("declares a fast poller failing on its third failure in a row, once", async () => {
      const fn = jest.fn(() => Promise.reject(new Error("upstream down")));
      registry.registerPoller(fn, 1000, "fast");
      registry.startAll();
      await settle();
      for (let i = 0; i < 4; i++) {
        jest.advanceTimersByTime(1000);
        await settle();
      }

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
      let calls = 0;
      const fn = jest.fn(() => (++calls === 1 ? Promise.reject(new Error("blip")) : undefined));
      registry.registerPoller(fn, 1000, "blippy");
      registry.startAll();
      await settle();
      jest.advanceTimersByTime(1000);
      await settle();

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info.mock.calls.map(([f]: [{ event: string }]) => f.event)).not.toContain(
        "poller.recovered",
      );
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it("declares a slow poller on its first failure, and logs its recovery", async () => {
      let calls = 0;
      const fn = jest.fn(() => (++calls === 1 ? Promise.reject(new Error("sweep failed")) : undefined));
      registry.registerPoller(fn, 60_000, "slow");
      registry.startAll();
      await settle();
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
      registry.registerPoller(
        () => {
          throw new Error("sync");
        },
        60_000,
        "thrower",
      );
      registry.startAll();
      await settle();
      expect(events(logger.error)).toEqual(["poller.failing"]);
    });

    it("reminds every 15 minutes while a poller stays down", async () => {
      registry.registerPoller(() => Promise.reject(new Error("down")), 60_000, "down");
      registry.startAll();
      await settle();
      for (let i = 0; i < 16; i++) {
        jest.advanceTimersByTime(60_000);
        await settle();
      }
      expect(events(logger.warn)).toEqual(["poller.still_failing"]);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("Sentry cron heartbeat", () => {
    it("checks in ok every 5 minutes, and error while a poller is failing", async () => {
      let failing = false;
      registry.registerPoller(
        () => (failing ? Promise.reject(new Error("x")) : undefined),
        60_000,
        "p",
      );
      registry.startAll();
      await settle();

      jest.advanceTimersByTime(5 * 60_000);
      await settle();
      expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
        { monitorSlug: "skkuverse-pollers", status: "ok" },
        expect.objectContaining({ schedule: { type: "interval", value: 5, unit: "minute" } }),
      );

      failing = true;
      // Fake timers do not run promise callbacks between timers, so let the
      // failed tick settle before the next check-in is due.
      jest.advanceTimersByTime(60_000);
      await settle();
      jest.advanceTimersByTime(4 * 60_000);
      await settle();
      expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
        { monitorSlug: "skkuverse-pollers", status: "error" },
        expect.anything(),
      );
    });

    it("stops checking in after stopAll", () => {
      registry.registerPoller(jest.fn(), 60_000, "p");
      registry.startAll();
      registry.stopAll();
      jest.advanceTimersByTime(10 * 60_000);
      expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
    });
  });

  describe("stopAll", () => {
    it("clears all intervals so no further ticks fire", () => {
      const fn = jest.fn();
      registry.registerPoller(fn, 1000, "stop");
      registry.startAll();
      expect(fn).toHaveBeenCalledTimes(1);

      registry.stopAll();
      jest.advanceTimersByTime(5000);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("is idempotent", () => {
      registry.registerPoller(jest.fn(), 1000, "idem");
      registry.startAll();
      registry.stopAll();
      expect(() => registry.stopAll()).not.toThrow();
    });
  });

  describe("isReady", () => {
    it("is false before startAll, even when pollers are registered", () => {
      registry.registerPoller(jest.fn(), 1000, "r");
      expect(registry.isReady()).toBe(false);
    });

    it("is true after startAll when at least one poller is registered", () => {
      registry.registerPoller(jest.fn(), 1000, "r");
      registry.startAll();
      expect(registry.isReady()).toBe(true);
    });

    it("is false after stopAll", () => {
      registry.registerPoller(jest.fn(), 1000, "r");
      registry.startAll();
      registry.stopAll();
      expect(registry.isReady()).toBe(false);
    });

    it("is true only when all registered pollers have a live interval", () => {
      registry.registerPoller(jest.fn(), 1000, "a");
      registry.registerPoller(jest.fn(), 1000, "b");
      registry.registerPoller(jest.fn(), 1000, "c");
      registry.startAll();
      // 3 registered → 3 intervals → ready
      expect(registry.isReady()).toBe(true);
    });
  });

  describe("Nest lifecycle hooks", () => {
    it("onApplicationBootstrap starts pollers when ROLE !== 'api' (combined)", () => {
      const prev = process.env.ROLE;
      delete process.env.ROLE; // → "combined"
      registry.registerPoller(jest.fn(), 1000, "x");
      registry.onApplicationBootstrap();
      expect(registry.isReady()).toBe(true);
      if (prev === undefined) delete process.env.ROLE;
      else process.env.ROLE = prev;
    });

    it("onApplicationBootstrap does NOT start pollers under ROLE=api", () => {
      const prev = process.env.ROLE;
      process.env.ROLE = "api";
      registry.registerPoller(jest.fn(), 1000, "x");
      registry.onApplicationBootstrap();
      expect(registry.isReady()).toBe(false);
      if (prev === undefined) delete process.env.ROLE;
      else process.env.ROLE = prev;
    });

    it("onApplicationShutdown stops all pollers", () => {
      registry.registerPoller(jest.fn(), 1000, "x");
      registry.startAll();
      expect(registry.isReady()).toBe(true);
      registry.onApplicationShutdown();
      expect(registry.isReady()).toBe(false);
    });
  });
});
