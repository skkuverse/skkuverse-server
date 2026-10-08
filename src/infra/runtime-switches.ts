/**
 * (An operations detail is left out of the public history.)
 *
 *
 *
 *
 *
 *
 *
 */

export type RuntimeMode = "production" | "development" | "test";
export type PushDelivery = "live" | "suppressed";

export interface RuntimeSwitches {
  pushDelivery: PushDelivery;
  rateLimitEnabled: boolean;
  buildingSyncEnabled: boolean;
}

export const RUNTIME_SWITCH_NAMES = ["PUSH_DELIVERY", "RATE_LIMIT", "BUILDING_SYNC"] as const;

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

  return {
    switches: {
      pushDelivery,
      rateLimitEnabled: rateLimit === "on",
      buildingSyncEnabled: buildingSync === "on",
    },
    errors,
  };
}
