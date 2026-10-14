// QUIRK(sentry): main.ts imports this file first; the SDK instruments http and Express when they are first required.
// SEE: docs/reference/logging.md for what becomes a Sentry Issue: error-level log lines do not, they go to Sentry Logs.
import * as Sentry from "@sentry/nestjs";
import config from "./infra/config";
import { sentryOptions } from "./infra/sentry-options";

if (config.sentry.enabled) {
  Sentry.init(sentryOptions());
}
