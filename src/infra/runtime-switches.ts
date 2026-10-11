/**
 * SEE: docs/how-to/test-the-app-against-a-local-server.md — a local run holds credentials that reach real
 * people (the dev FCM_FUNCTION_URL pushes to every topic subscriber), so development switches outbound
 * side effects off. Per-run values, never in Doppler (__tests__/nest/infra/runtime-switches.test.ts).
 */

export type RuntimeMode = "production" | "development" | "test";
export type PushDelivery = "live" | "suppressed";

export interface RuntimeSwitches {
  pushDelivery: PushDelivery;
  rateLimitEnabled: boolean;
  buildingSyncEnabled: boolean;
  cacheEnabled: boolean;
  shuttleEtaEnabled: boolean;
}

export const RUNTIME_SWITCH_NAMES = [
  "PUSH_DELIVERY",
  "RATE_LIMIT",
  "BUILDING_SYNC",
  "CACHE",
  "SHUTTLE_ETA",
] as const;

export function runtimeMode(nodeEnv: string | undefined): RuntimeMode {
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "test";
  return "development";
}

type OnOff = "on" | "off";
type EnumReader = <T extends string>(name: string, allowed: readonly T[]) => T | undefined;

interface Resolution {
  read: EnumReader;
  mode: RuntimeMode;
  errors: string[];
}

const ON_OFF: readonly OnOff[] = ["on", "off"];

// WHY: a value outside `allowed` is reported, never coerced to the default.
function enumReader(env: NodeJS.ProcessEnv, errors: string[]): EnumReader {
  return <T extends string>(name: string, allowed: readonly T[]): T | undefined => {
    const raw = env[name];
    if (raw === undefined || raw === "") return undefined;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    errors.push(`${name} must be one of ${allowed.join(" | ")} (got "${raw}")`);
    return undefined;
  };
}

function pushDelivery(r: Resolution): PushDelivery {
  const local = r.mode === "development";
  const value = r.read("PUSH_DELIVERY", ["live", "suppressed"] as const) ?? (local ? "suppressed" : "live");
  if (local && value === "live") {
    r.errors.push(
      "PUSH_DELIVERY=live is refused in development: the Cloud Function pushes to every subscriber of a topic",
    );
    return "suppressed";
  }
  return value;
}

function isOn(r: Resolution, name: "RATE_LIMIT" | "BUILDING_SYNC" | "CACHE" | "SHUTTLE_ETA"): boolean {
  return (r.read(name, ON_OFF) ?? (r.mode === "development" ? "off" : "on")) === "on";
}

// WHY: a production override may only reduce outbound effects, never remove a guard.
function isGuardOn(r: Resolution, name: "RATE_LIMIT" | "CACHE"): boolean {
  const on = isOn(r, name);
  if (r.mode === "production" && !on) {
    r.errors.push(`${name}=off is refused in production`);
    return true;
  }
  return on;
}

export function resolveRuntimeSwitches(
  env: NodeJS.ProcessEnv,
  mode: RuntimeMode,
): { switches: RuntimeSwitches; errors: string[] } {
  const errors: string[] = [];
  const r: Resolution = { read: enumReader(env, errors), mode, errors };
  return {
    switches: {
      pushDelivery: pushDelivery(r),
      rateLimitEnabled: isGuardOn(r, "RATE_LIMIT"),
      buildingSyncEnabled: isOn(r, "BUILDING_SYNC"),
      cacheEnabled: isGuardOn(r, "CACHE"),
      shuttleEtaEnabled: isOn(r, "SHUTTLE_ETA"),
    },
    errors,
  };
}
