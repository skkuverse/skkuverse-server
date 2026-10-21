import { SERVICE_CONFIG } from "./bus.constants";
import type { ServiceConfigEntry } from "./bus.types";

// WHY: own keys only, so a service id that names an Object.prototype member (`toString`) is unknown.
export function serviceConfigOf(serviceId: string): ServiceConfigEntry | undefined {
  return Object.hasOwn(SERVICE_CONFIG, serviceId) ? SERVICE_CONFIG[serviceId] : undefined;
}

const refuseChange = (): never => {
  throw new TypeError("a frozen collection cannot change");
};

// WHY: Object.freeze leaves a Map's or Set's entries writable, so its mutators are replaced before the freeze.
function lockEntries(collection: Map<unknown, unknown> | Set<unknown>): void {
  for (const name of ["set", "add", "delete", "clear"]) {
    if (name in collection) Object.defineProperty(collection, name, { value: refuseChange });
  }
  for (const entry of collection.values()) deepFreeze(entry);
}

// WHY: a parsed revision is shared by every request, so nothing may change it once it is read.
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (value instanceof Map || value instanceof Set) lockEntries(value);
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return value;
}
