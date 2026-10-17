import { SERVICE_CONFIG } from "./bus.constants";
import type { ServiceConfigEntry, ServiceKeyProblem } from "./bus.types";

// QUIRK(topis): a raw base64 key (`+`, `=`, `/`) splits the query string and TOPIS rejects it as if it
// were down, so the key must be stored URL-encoded.
const URL_ENCODED_KEY = /^[A-Za-z0-9_%-]+$/;

export function validateServiceKey(key: unknown): ServiceKeyProblem | null {
  if (typeof key !== "string" || key.length === 0) return "missing";
  return URL_ENCODED_KEY.test(key) ? null : "not-url-encoded";
}

// WHY: own keys only, so a service id that names an Object.prototype member (`toString`) is unknown.
export function serviceConfigOf(serviceId: string): ServiceConfigEntry | undefined {
  return Object.hasOwn(SERVICE_CONFIG, serviceId) ? SERVICE_CONFIG[serviceId] : undefined;
}

// WHY: a parsed config is shared by every request, so nothing may change it after the boot check.
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return value;
}
