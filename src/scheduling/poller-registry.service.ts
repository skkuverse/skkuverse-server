import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import config from "../infra/config";
import logger from "../infra/logger";

type PollerFn = () => Promise<unknown> | unknown;

interface PollerRegistration {
  fn: PollerFn;
  intervalMs: number;
  name: string;
}

interface PollerHealth {
  isFast: boolean;
  failures: number;
  failingSince: number | null;
  isDeclaredFailing: boolean;
  lastReportAt: number;
}

// WHY: a fast poller is declared failing only after a run of failed ticks, so one timeout pages no
// one; a slow one (a minute or more between ticks) on its first, since by its third it is an hour late.
const FAST_POLLER_MS = 60_000;
const FAST_FAIL_AFTER = 3;
const STILL_FAILING_EVERY_MS = 15 * 60_000;

// QUIRK(sentry): the cron monitor is created from MONITOR_CONFIG on its first check-in, and raises an
// Issue when check-ins report "error" or stop coming: a dead or hung poller process logs nothing.
const HEARTBEAT_MS = 5 * 60_000;
const MONITOR_SLUG = "skkuverse-pollers";
const MONITOR_CONFIG = {
  schedule: { type: "interval", value: 5, unit: "minute" },
  checkinMargin: 5,
  failureIssueThreshold: 2,
  recoveryThreshold: 1,
} as const;
const PING_TIMEOUT_MS = 5_000;

// SEE: docs/reference/logging.md for the poller.failing, poller.still_failing and poller.recovered lines.
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

  private startAll(): void {
    this.intervalIds = this.registeredPollers.map(({ fn, intervalMs, name }) => {
      logger.info({ event: "poller.started", name, intervalMs }, "Starting poller");
      const health = this.trackHealth(name, intervalMs);
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
        // WHY: the warm-up run calls fn synchronously, so a synchronous throw is turned into a
        // rejection here rather than escaping startAll.
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

  private stopAll(): void {
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

  // QUIRK(nest): every onModuleInit, where the pollers register, runs before any
  // onApplicationBootstrap, so startAll sees every registration.
  onApplicationBootstrap(): void {
    if (config.runsPollers()) {
      this.startAll();
    }
  }

  onApplicationShutdown(): void {
    this.stopAll();
  }

  private trackHealth(name: string, intervalMs: number): PollerHealth {
    const health: PollerHealth = {
      isFast: intervalMs < FAST_POLLER_MS,
      failures: 0,
      failingSince: null,
      isDeclaredFailing: false,
      lastReportAt: 0,
    };
    this.health.set(name, health);
    return health;
  }

  private recordSuccess(name: string, health: PollerHealth): void {
    if (health.isDeclaredFailing) {
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
    health.isDeclaredFailing = false;
  }

  private recordFailure(name: string, health: PollerHealth, err: unknown): void {
    const now = Date.now();
    health.failures += 1;
    if (health.failingSince === null) health.failingSince = now;
    const failAfter = health.isFast ? FAST_FAIL_AFTER : 1;

    if (!health.isDeclaredFailing && health.failures >= failAfter) {
      health.isDeclaredFailing = true;
      health.lastReportAt = now;
      logger.error(
        { event: "poller.failing", name, failures: health.failures, err },
        "Poller failing",
      );
      Sentry.captureException(err, { tags: { poller: name } });
      return;
    }
    if (health.isDeclaredFailing && now - health.lastReportAt >= STILL_FAILING_EVERY_MS) {
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

  // WHY: a slow poller's first failure already opened its own Issue, and its "error" would last an
  // interval (a week for building-sync), hiding the fast pollers.
  private heartbeat(): void {
    const down = [...this.health.values()].some((h) => h.isFast && h.isDeclaredFailing);
    Sentry.captureCheckIn(
      { monitorSlug: MONITOR_SLUG, status: down ? "error" : "ok" },
      MONITOR_CONFIG,
    );
    if (!down) void this.pingHealthchecks();
  }

  // (An operations detail is left out of the public history.)
  private async pingHealthchecks(): Promise<void> {
    const url = config.healthchecks.pollerPingUrl();
    if (!url) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      await res.body?.cancel();
      if (!res.ok) {
        logger.warn({ event: "poller.healthchecks_ping_failed", status: res.status }, "Healthchecks.io ping failed");
      }
    } catch (err) {
      const reason = err instanceof Error ? err.name : typeof err;
      logger.warn({ event: "poller.healthchecks_ping_failed", reason }, "Healthchecks.io ping failed");
    } finally {
      clearTimeout(timer);
    }
  }
}
