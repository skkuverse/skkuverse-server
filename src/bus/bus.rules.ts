import { SERVICE_CONFIG } from "./bus.constants";
import type { ServiceConfigEntry, ServiceKeyProblem } from "./bus.types";

// QUIRK(topis): a raw base64 key (`+`, `=`, `/`) splits the query string and TOPIS rejects it as if it
// were down, so the key must be stored URL-encoded.
const URL_ENCODED_KEY = /^[A-Za-z0-9_%-]+$/;

export function validateServiceKey(key: unknown): ServiceKeyProblem | null {
  if (typeof key !== "string" || key.length === 0) return "missing";
  return URL_ENCODED_KEY.test(key) ? null : "not-url-encoded";
}

// QUIRK(topis): some loops list their first stop again as the last ord (02: ord 1 and ord 27).
export function isLoopClosingRepeat(topisIds: readonly string[], index: number): boolean {
  return index > 0 && index === topisIds.length - 1 && topisIds[index] === topisIds[0];
}

// WHY: own keys only, so a service id that names an Object.prototype member (`toString`) is unknown.
export function serviceConfigOf(serviceId: string): ServiceConfigEntry | undefined {
  return Object.hasOwn(SERVICE_CONFIG, serviceId) ? SERVICE_CONFIG[serviceId] : undefined;
}
