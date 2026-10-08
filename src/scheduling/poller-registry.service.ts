import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import logger from "../infra/logger";

type PollerFn = () => Promise<unknown> | unknown;

interface PollerRegistration {
  fn: PollerFn;
  intervalMs: number;
  name: string;
}

/** Health of one poller, kept between ticks. */
interface PollerHealth {
  /** Under FAST_POLLER_MS between ticks: debounced, and counted by the cron monitor. */
  fast: boolean;
  failures: number;
  failingSince: number | null;
  /** Declared failing: the error has been logged and sent to Sentry. */
  declared: boolean;
  lastReportAt: number;
}

/**
 * A fast poller is declared failing after this many failed ticks in a row, so
 * one timeout does not page anyone. A slow one (a minute or more between
 * ticks) is declared on its first failure: by the third it would be an hour
 * late.
 */
const FAST_POLLER_MS = 60_000;
const FAST_FAIL_AFTER = 3;
/** While a poller stays down, say so again this often (warn, Sentry Logs only). */
const STILL_FAILING_EVERY_MS = 15 * 60_000;

/**
 * Sentry cron monitor for the poller process. Every few minutes it checks in:
 * "error" while a fast poller is declared failing, "ok" otherwise. A slow
 * poller is left out: its first failure already opened its own Issue, and its
 * "error" would last at least one interval (a week for building-sync), hiding
 * the fast pollers. Sentry raises an Issue when check-ins report errors or stop
 * coming — the second case being a poller process that died or hangs, which no
 * log line can report. Created on the first check-in from `monitorConfig`.
 */
const HEARTBEAT_MS = 5 * 60_000;
const MONITOR_SLUG = "skkuverse-pollers";
const MONITOR_CONFIG = {
  schedule: { type: "interval", value: 5, unit: "minute" },
  checkinMargin: 5,
  failureIssueThreshold: 2,
  recoveryThreshold: 1,
} as const;

/**
 * Runs the registered pollers: an immediate warm-up run, then one per
 * interval, never two of the same poller at once.
 *
 * A poller reports its outcome by resolving or rejecting; it does not log its
 * own failures. The registry turns outcomes into state transitions — one error
 * line (and one Sentry Issue) when a poller becomes failing, a reminder while
 * it stays down, one info line when it recovers — so an upstream outage costs
 * a few lines instead of one per tick. Single failed ticks are debug. Only the
 * fast pollers drive the cron monitor; a slow one reports through its own Issue.
 *
 * Lifecycle:
 *  - Poller services register themselves in their own onModuleInit (module init
 *    phase), which always precedes onApplicationBootstrap (app bootstrap phase),
 *    so all registrations are complete before startAll() may fire here.
 *  - onApplicationBootstrap: startAll() gated on ROLE !== "api" (covers
 *    "poller" and "combined"; under "api" no pollers start).
 *  - onApplicationShutdown: stopAll().
 */
@Injectable()
export class PollerRegistryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly registeredPollers: PollerRegistration[] = [];
  private intervalIds: NodeJS.Timeout[] = [];
  private heartbeatId: NodeJS.Timeout | null = null;
  private readonly health = new Map<string, PollerHealth>();

  registerPoller(fn: PollerFn, intervalMs: number, name: string): void {
    this.registeredPollers.push({ fn, intervalMs, name });
  }

  startAll(): void {
    this.intervalIds = this.registeredPollers.map(({ fn, intervalMs, name }) => {
      logger.info({ event: "poller.started", name, intervalMs }, "Starting poller");
      const health: PollerHealth = {
        fast: intervalMs < FAST_POLLER_MS,
        failures: 0,
        failingSince: null,
        declared: false,
        lastReportAt: 0,
      };
      this.health.set(name, health);
      let inFlight = false;
      const guarded = (): void => {
        if (inFlight) {
          logger.debug(
            { event: "poller.skipped_in_flight", name },
            "Poller skipped: previous run still in flight",
          );
          return;
        }
        inFlight = true;
        // Called synchronously (the warm-up run starts at once); a synchronous
        // throw is treated like a rejection.
        let result: unknown;
        try {
          result = fn();
        } catch (err) {
          result = Promise.reject(err);
        }
        Promise.resolve(result)
          .then(
            () => this.recordSuccess(name, health),
            (err: unknown) => this.recordFailure(name, health, err),
          )
          .finally(() => {
            inFlight = false;
          });
      };
      guarded();
      return setInterval(guarded, intervalMs);
    });
    this.heartbeatId = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  }

  stopAll(): void {
    this.intervalIds.forEach(clearInterval);
    this.intervalIds = [];
    if (this.heartbeatId) clearInterval(this.heartbeatId);
    this.heartbeatId = null;
  }

  isReady(): boolean {
    return (
      this.intervalIds.length > 0 &&
      this.intervalIds.length === this.registeredPollers.length
    );
  }

  /** Names of the pollers currently declared failing. */
  failingPollers(): string[] {
    return [...this.health].filter(([, h]) => h.declared).map(([name]) => name);
  }

  onApplicationBootstrap(): void {
    const role = process.env.ROLE || "combined";
    if (role !== "api") {
      this.startAll();
    }
  }

  onApplicationShutdown(): void {
    this.stopAll();
  }

  private recordSuccess(name: string, health: PollerHealth): void {
    if (health.declared) {
      logger.info(
        {
          event: "poller.recovered",
          name,
          failures: health.failures,
          downMs: Date.now() - (health.failingSince ?? Date.now()),
        },
        "Poller recovered",
      );
    }
    health.failures = 0;
    health.failingSince = null;
    health.declared = false;
  }

  private recordFailure(name: string, health: PollerHealth, err: unknown): void {
    const now = Date.now();
    health.failures += 1;
    if (health.failingSince === null) health.failingSince = now;
    const failAfter = health.fast ? FAST_FAIL_AFTER : 1;

    if (!health.declared && health.failures >= failAfter) {
      health.declared = true;
      health.lastReportAt = now;
      logger.error(
        { event: "poller.failing", name, failures: health.failures, err },
        "Poller failing",
      );
      Sentry.captureException(err, { tags: { poller: name } });
      return;
    }
    if (health.declared && now - health.lastReportAt >= STILL_FAILING_EVERY_MS) {
      health.lastReportAt = now;
      logger.warn(
        {
          event: "poller.still_failing",
          name,
          failures: health.failures,
          downMs: now - health.failingSince,
          err,
        },
        "Poller still failing",
      );
      return;
    }
    logger.debug(
      { event: "poller.tick_failed", name, failures: health.failures, err },
      "Poller tick failed",
    );
  }

  private heartbeat(): void {
    const down = [...this.health.values()].some((h) => h.fast && h.declared);
    Sentry.captureCheckIn(
      { monitorSlug: MONITOR_SLUG, status: down ? "error" : "ok" },
      MONITOR_CONFIG,
    );
  }
}
