import "dotenv/config";
import logger from "./logger";
import * as requiredEnv from "./required-env";
import { resolveRuntimeSwitches, runtimeMode } from "./runtime-switches";

const mode = requiredEnv.envMode(process.env);
const { nodeEnv: NODE_ENV, isProduction, isTest, isDevelopment, useProdApi: USE_PROD_API } = mode;

// Outbound side effects a local run must not cause (push, crawl) and the
// limiter. Defaults per mode and the refused combinations: runtime-switches.ts.
const { switches, errors: switchErrors } = resolveRuntimeSwitches(
  process.env,
  runtimeMode(NODE_ENV),
);

// Typed `string`: every DB name read through this is in required-env.ts's list,
// so the missing-config exit at the end of this file runs before any caller
// reads one (test mode skips that exit; jest.setup.ts sets every name).
const devDbName = (baseName: string | undefined) => requiredEnv.devDbName(mode, baseName) as string;
const apiUrl = (prodKey: string, devKey: string) => requiredEnv.apiUrl(mode, process.env, prodKey, devKey);

const config = {
  env: NODE_ENV,
  isProduction,
  isDevelopment,
  isTest,
  useProdApi: USE_PROD_API,
  port: process.env.PORT || 3000,

  mongo: {
    url: process.env.MONGO_URL,
    dbName: devDbName(process.env.MONGO_DB_NAME_BUS_CAMPUS),
    collections: {
      busCache: process.env.MONGO_CACHE_COLLECTION || "bus_cache",
    },
  },

  ad: {
    // Strict: no fallback to MONGO_DB_NAME_BUS_CAMPUS. Missing MONGO_AD_DB_NAME
    // must crash loudly rather than silently redirecting ad writes to the
    // bus_campus DB. Required-array entry below enforces this at startup.
    dbName: devDbName(process.env.MONGO_AD_DB_NAME),
    collections: {
      ads: process.env.MONGO_AD_COLLECTION || "ads",
      adEvents: process.env.MONGO_AD_EVENTS_COLLECTION || "ad_events",
    },
  },

  building: {
    dbName: devDbName(process.env.MONGO_BUILDING_DB_NAME),
    collections: {
      buildings: "buildings",
      buildingsRaw: "buildings_raw",
      spaces: "spaces",
      connections: "connections",
      // Hand-authored campus geometry. Not synced from campusMap.do — see
      // CampusShapeDoc for why it is a sibling collection rather than a field.
      campusShapes: "campus_shapes",
    },
    syncIntervalMs:
      parseInt(process.env.BUILDING_SYNC_INTERVAL_MS || "", 10) ||
      7 * 24 * 60 * 60 * 1000, // 7 days
    // BUILDING_SYNC. Off in development: the poller's warm-up crawls all of
    // campusMap.do and rewrites skkumap_dev on every boot, and nodemon reboots
    // on every save.
    syncEnabled: switches.buildingSyncEnabled,
  },

  notices: {
    dbName: devDbName(process.env.MONGO_NOTICES_DB_NAME),
    collections: {
      notices: process.env.MONGO_NOTICES_COLLECTION || "notices",
    },
    // Strict: no literal default. Service start date is a filter boundary
    // that must be explicit per environment — silently reverting to an old
    // date could expose notices the ops team intended to hide.
    serviceStartDate: process.env.NOTICES_SERVICE_START_DATE,

    // AI overview for a search (GET /notices/overview). The ai service is
    // skkuverse-ai on the shared `skkuverse` docker network; its contract is
    // owned there (skkuverse-ai/docs/notice-overview-api.md). Strict: no default — a missing
    // URL must fail boot, not silently disable the feature.
    overview: {
      aiApiUrl: process.env.AI_API_URL,
    },

    // FCM dispatch via deployed Cloud Function. Trigger is the crawler's
    // cycle-end ping; the cron is a safety net only.
    dispatch: {
      functionUrl: process.env.FCM_FUNCTION_URL,
      apiKey: process.env.FCM_API_KEY,
      internalToken: process.env.INTERNAL_DISPATCH_TOKEN,
      // Outer bound on push age, measured against the notice's own
      // publication `date` (Asia/Seoul, YYYY-MM-DD) — NOT against when we
      // crawled it. Older rows are abandoned to avoid spamming users with
      // stale "new" notices after a long outage.
      //
      // This used to be `maxAgeMs: 24h` against `crawledAt`. That could not
      // survive the crawler dropping its no-op touch (skkuverse#52): the
      // touch is the only reason a not-yet-pushed notice stays inside a 24h
      // crawledAt window, and 8.9% of notices pushed in Sept 2026 were
      // summarized more than 24h after insert (n=313) — every one of those
      // would have gone silent. `date` is immutable, so summarization lag
      // cannot age a notice out before it is eligible.
      //
      // 14 days is not a guess: replayed with this exact predicate against
      // all 2,498 real pushes since 2026-08-01, it matches 2,498 of 2,498
      // (max observed gap 10.6d) — a measured no-op on current traffic.
      // See docs/decisions/0008-dispatch-age-gate-on-publication-date.md.
      maxAgeDays: 14,
      // Claim lease — 10× the FCM timeout so a slow round trip won't trip
      // a re-claim, but short enough that a crashed dispatcher's claims
      // free up on the next sweep.
      claimLeaseMs: 5 * 60 * 1000,
      // Safety-net cron only. Primary trigger is the crawler ping.
      sweepCronIntervalMs:
        parseInt(process.env.NOTICES_DISPATCH_SWEEP_MS || "", 10) ||
        30 * 60 * 1000,
      maxAttempts: 5,
      fcmTimeoutMs: 30 * 1000,
      // Cap blast radius of a single sweep tick.
      sweepBatchCap: 200,
    },
  },

  eventmap: {
    // Strict: no fallback. A missing MONGO_EVENTMAP_DB_NAME must crash at boot
    // rather than silently writing event content into bus_campus.
    dbName: devDbName(process.env.MONGO_EVENTMAP_DB_NAME),
    collections: {
      activations: "activations",
      places: "places",
    },
  },

  miniapps: {
    // Strict, no fallback — same reasoning as eventmap.dbName. A missing
    // MONGO_MINIAPPS_DB_NAME must crash at boot rather than silently writing a
    // mini app's broadcast log into bus_campus.
    //
    // Its own database rather than a collection inside eventmap's: one database
    // per domain is the pattern here (notices, ads, buildings, eventmap each
    // have one), and a mini-app feed outlives any single event map.
    dbName: devDbName(process.env.MONGO_MINIAPPS_DB_NAME),
    collections: {
      sentNotifications: "sent_notifications",
    },
    /** Feed page size. The feed is a recent-history surface, not an archive. */
    feedLimit: 50,
  },

  firebase: {
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT || null,
  },

  // PUSH_DELIVERY. "suppressed" makes infra/fcm.ts log the payload and
  // report an empty delivery instead of calling the Cloud Function.
  push: {
    delivery: switches.pushDelivery,
  },

  // RATE_LIMIT. Every express-rate-limit instance skips while this is false
  // (infra/rateLimitKeys.ts). Off in development, where every simulator
  // request arrives from the same loopback address.
  rateLimit: {
    enabled: switches.rateLimitEnabled,
  },

  // CACHE. While false, createCachedLoader and the timetable and ad caches load
  // on every call, and http/no-store.middleware.ts rewrites every Cache-Control to
  // no-store, so a _dev database change shows on the next request. Off in
  // development.
  cache: {
    enabled: switches.cacheEnabled,
  },

  // SHUTTLE_ETA. While false, the shuttle arrival-estimate pollers are not
  // registered, so no NAVER Directions or TMAP call is made; serving still
  // applies stored estimates. Off in development.
  //
  // The credentials are required even then, so a rendered .env without them
  // fails at boot instead of at a poller's first tick. NAVER is the NCP
  // application the crawler also uses. TMAP is one SK open API app for dev and
  // prd (its terms count several apps for one service as abuse), so
  // development gets a small share of its 1,000 daily calls.
  shuttleEta: {
    enabled: switches.shuttleEtaEnabled,
    naver: {
      keyId: process.env.NAVER_API_KEY_ID,
      key: process.env.NAVER_API_KEY,
    },
    tmapAppKey: process.env.TMAP_APP_KEY,
    naverDailyCap: 1000,
    tmapDailyCap: isProduction ? 900 : 50,
  },

  // Error and log collection (src/instrument.ts). Required in production;
  // the literal "disabled" turns it off explicitly (docker-compose.local-verify.yml).
  // GIT_SHA is baked into the image at build time (Dockerfile ARG).
  sentry: {
    dsn: process.env.SENTRY_DSN,
    enabled: !!process.env.SENTRY_DSN && process.env.SENTRY_DSN !== "disabled",
    environment: process.env.SENTRY_ENVIRONMENT || NODE_ENV,
    release: process.env.GIT_SHA || undefined,
  },

  app: {
    ios: {
      minVersion: process.env.APP_IOS_MIN_VERSION || "1.0.0",
      updateUrl: process.env.APP_IOS_UPDATE_URL || null,
    },
    android: {
      minVersion: process.env.APP_ANDROID_MIN_VERSION || "1.0.0",
      updateUrl: process.env.APP_ANDROID_UPDATE_URL || null,
    },
  },

  naver: {
    styleId: process.env.NAVER_MAP_STYLE_ID,
  },

  api: {
    hsscNew: apiUrl("API_HSSC_NEW_PROD", "API_HSSC_NEW_DEV"),
    // Shared Seoul TOPIS service key (URL-encoded). Per-route facts
    // (busRouteId, station count) live in `src/bus/registry/jongro-routes.json`
    // and the registry composes the list/loc URLs at module load.
    seoulBusServiceKey: process.env.SEOUL_BUS_SERVICE_KEY,
    stationHyehwa: process.env.API_STATION_HEWA,
  },

  getModeLabel(): string {
    if (isProduction) return "PRODUCTION (prod DB + prod API)";
    if (isDevelopment && USE_PROD_API) return "STAGING CHECK (dev DB + prod API)";
    if (isDevelopment) return "DEVELOPMENT (dev DB + dev API)";
    if (isTest) return "TEST";
    return `UNKNOWN (NODE_ENV=${NODE_ENV})`;
  },

  /** The runtime switches as they resolved, for the boot log line. */
  getSideEffectsSummary(): {
    push: string;
    rateLimit: string;
    buildingSync: string;
    cache: string;
    shuttleEta: string;
  } {
    return {
      push: switches.pushDelivery,
      rateLimit: switches.rateLimitEnabled ? "on" : "off",
      buildingSync: switches.buildingSyncEnabled ? "on" : "off",
      cache: switches.cacheEnabled ? "on" : "off",
      shuttleEta: switches.shuttleEtaEnabled ? "on" : "off",
    };
  },
};

// (An operations detail is left out of the public history.)
const missing = requiredEnv.listMissingRequired(process.env).map(({ name, env }) => ({ name, env }));
if (missing.length > 0) {
  logger.fatal(
    { event: "config.missing_required", missing },
    "Missing required config — set the env vars in `missing`",
  );
  if (!isTest) {
    process.exit(1);
  }
}

if (switchErrors.length > 0) {
  logger.fatal(
    { event: "config.invalid_runtime_switch", errors: switchErrors },
    "Invalid runtime switch — fix the env vars named in `errors`",
  );
  if (!isTest) {
    process.exit(1);
  }
}

export = config;
