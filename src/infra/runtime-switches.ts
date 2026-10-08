/**
 * The side effects that differ between a production process and a local one,
 * resolved in one place.
 *
 * A local `npm run dev` holds credentials that reach real people: the dev
 * Doppler config carries a FCM_FUNCTION_URL for the one Firebase project the
 * app uses, and that Cloud Function pushes by topic — to every subscriber, not
 * to the developer's own phone. So development defaults every outbound side
 * effect to off, and production keeps today's behavior:
 *
 *   | env var         | production | development | test |
 *   |-----------------|------------|-------------|------|
 *   | PUSH_DELIVERY   | live       | suppressed  | live |
 *   | RATE_LIMIT      | on         | off         | on   |
 *   | BUILDING_SYNC   | on         | off         | on   |
 *   | CACHE           | on         | off         | on   |
 *
 * CACHE is not a side effect but the same kind of local-only difference: with
 * it off, a change to a _dev database shows on the next request instead of
 * after a TTL. It bypasses the in-process caches (common/cache/cached-loader.ts,
 * the bus timetable, the ad placements) and rewrites every Cache-Control to
 * no-store (common/no-store.ts), which keeps the phone's HTTP cache from
 * answering for the server. The AI overview and mini-app manifest caches stay
 * on: one saves an LLM call per request, the other a fetch to a production
 * origin, and neither holds _dev data.
 *
 * An explicit value overrides the default, within these refusals:
 *
 *   - PUSH_DELIVERY=live in development. There is no safe way to send from a
 *     laptop, so there is no switch for it.
 *   - RATE_LIMIT=off or CACHE=off in production. A production override may
 *     only reduce outbound effects (push suppressed, building sync off — what
 *     docker-compose.local-verify.yml sets), never remove a guard or put the
 *     full request rate on Atlas.
 *
 * PUSH_DELIVERY=suppressed in production drops pushes; it does not pause them.
 * The dispatcher still claims each notice and stamps pushedAt, so nothing is
 * sent later. It exists for local verify, not as an incident switch.
 *
 * Test keeps production's defaults: every test mocks fetch, and the limiter
 * tests expect 429s.
 *
 * Both fail-loud layers call this — src/infra/config.ts exits on `errors`,
 * src/config/env.validation.ts throws on them — so the two cannot disagree.
 * These are per-run values like USE_PROD_API and ROLE: they are not in Doppler
 * or config/env.*.keys, and __tests__/nest/infra/runtime-switches.test.ts fails
 * if production's compose file or key list ever sets one.
 */

export type RuntimeMode = "production" | "development" | "test";
export type PushDelivery = "live" | "suppressed";

export interface RuntimeSwitches {
  pushDelivery: PushDelivery;
  rateLimitEnabled: boolean;
  buildingSyncEnabled: boolean;
  cacheEnabled: boolean;
}

export const RUNTIME_SWITCH_NAMES = [
  "PUSH_DELIVERY",
  "RATE_LIMIT",
  "BUILDING_SYNC",
  "CACHE",
] as const;

/** Same reading as config.ts: anything but production or test is development. */
export function runtimeMode(nodeEnv: string | undefined): RuntimeMode {
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "test";
  return "development";
}

/**
 * Reads one enum env var. Unset (or empty) is `undefined`; a value outside
 * `allowed` is reported, never coerced to a default.
 */
function readEnum<T extends string>(
  env: NodeJS.ProcessEnv,
  name: string,
  allowed: readonly T[],
  errors: string[],
): T | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  errors.push(`${name} must be one of ${allowed.join(" | ")} (got "${raw}")`);
  return undefined;
}

export function resolveRuntimeSwitches(
  env: NodeJS.ProcessEnv,
  mode: RuntimeMode,
): { switches: RuntimeSwitches; errors: string[] } {
  const errors: string[] = [];
  const local = mode === "development";

  let pushDelivery: PushDelivery =
    readEnum(env, "PUSH_DELIVERY", ["live", "suppressed"] as const, errors) ??
    (local ? "suppressed" : "live");
  if (local && pushDelivery === "live") {
    errors.push(
      "PUSH_DELIVERY=live is refused in development: the Cloud Function pushes to every subscriber of a topic",
    );
    pushDelivery = "suppressed";
  }

  let rateLimit = readEnum(env, "RATE_LIMIT", ["on", "off"] as const, errors) ?? (local ? "off" : "on");
  if (mode === "production" && rateLimit === "off") {
    errors.push("RATE_LIMIT=off is refused in production");
    rateLimit = "on";
  }

  const buildingSync =
    readEnum(env, "BUILDING_SYNC", ["on", "off"] as const, errors) ?? (local ? "off" : "on");

  let cache = readEnum(env, "CACHE", ["on", "off"] as const, errors) ?? (local ? "off" : "on");
  if (mode === "production" && cache === "off") {
    errors.push("CACHE=off is refused in production");
    cache = "on";
  }

  return {
    switches: {
      pushDelivery,
      rateLimitEnabled: rateLimit === "on",
      buildingSyncEnabled: buildingSync === "on",
      cacheEnabled: cache === "on",
    },
    errors,
  };
}
