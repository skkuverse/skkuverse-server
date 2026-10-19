import { SERVICE_CONFIG } from "./bus.constants";
import type { ServiceConfigEntry } from "./bus.types";

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
