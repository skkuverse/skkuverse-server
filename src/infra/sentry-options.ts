/** WHY: apart from the init (src/instrument.ts), so a test can run the SDK with exactly these options. */
import * as Sentry from "@sentry/nestjs";
import config from "./config";
import { LOGGED_REQUEST_HEADERS } from "./log-redact";
import { flattenLogAttributes, scrubBreadcrumb, scrubEvent } from "./sentry-scrub";

export function sentryOptions(): Sentry.NodeOptions {
  return {
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    release: config.sentry.release,
    // QUIRK(sentry): v11 collects nearly everything by default. Collect only what the log does: no
    // cookies, bodies, user fields or stack-frame locals, which can hold a token or a service key.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: [...LOGGED_REQUEST_HEADERS] }, response: false },
      httpBodies: [],
      urlQueryParams: true,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    integrations: [
      // WHY: Sentry is for errors, Grafana Loki for logs (docs/reference/logging.md). No line goes to
      // Sentry Logs, and no error-level line becomes an Issue.
      Sentry.pinoIntegration({
        log: { levels: [] },
        error: { levels: [] },
      }),
    ],
    // QUIRK(data-go-kr): its gateway answers 400 INVALID_REQUEST_PARAMETER_ERROR to a request whose header
    // holds `environment=`, as Sentry's `baggage` does. No service this server calls reads Sentry traces.
    tracePropagationTargets: [],
    initialScope: { tags: { role: config.role(), perimeter_overlay: config.perimeter.overlayBuild } },
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendLog: flattenLogAttributes,
  };
}
