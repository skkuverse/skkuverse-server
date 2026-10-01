/**
 * Sentry — error events, plus every info-and-above log line via pino (logs are
 * on by default in SDK v11).
 *
 * Imported by main.ts before anything else: the SDK instruments `http` and
 * Express when they are first required, so they must not be loaded yet.
 *
 * What becomes an Issue (the free plan allows 5k error events a month) is kept
 * deliberate:
 *  - unknown errors that reach the exception filter (5xx) — captured there;
 *  - a poller being declared failing, once per failing spell — captured by
 *    the poller registry;
 *  - uncaught exceptions and unhandled rejections — the SDK's own handlers.
 * Error-level log lines are NOT promoted to Issues (`error.levels: []`). A
 * poller logs an error on every failed tick; during an upstream outage that is
 * one every 10 s, which would spend the month's quota in a day. They arrive in
 * Sentry Logs instead.
 *
 * Tracing is off (no tracesSampleRate): nothing here needs spans yet.
 */
import * as Sentry from "@sentry/nestjs";
import config from "./infra/config";
import { sentryOptions } from "./infra/sentry-options";

if (config.sentry.enabled) {
  Sentry.init(sentryOptions());
}
