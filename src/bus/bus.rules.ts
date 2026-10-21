import { SERVICE_CONFIG } from "./bus.constants";
import type { ServiceConfigEntry } from "./bus.types";

// WHY: own keys only, so a service id that names an Object.prototype member (`toString`) is unknown.
export function serviceConfigOf(serviceId: string): ServiceConfigEntry | undefined {
  return Object.hasOwn(SERVICE_CONFIG, serviceId) ? SERVICE_CONFIG[serviceId] : undefined;
}

const refuseChange = (): never => {
  throw new TypeError("a frozen collection cannot change");
};

type Collection = Map<unknown, unknown> | Set<unknown>;

// WHY: the own `delete` deepFreeze defines shadows the prototype's; nothing else gives a Map or Set one.
const isLocked = (collection: Collection): boolean => Object.hasOwn(collection, "delete");

// WHY: Object.freeze leaves a Map's or Set's entries writable, so its mutators are replaced before the freeze. One
// frozen elsewhere takes no new property, so it is refused rather than left writable.
function lockEntries(collection: Collection, seen: WeakSet<object>): void {
  if (!isLocked(collection) && !Object.isExtensible(collection)) throw new TypeError("a Map or Set frozen before deepFreeze cannot be locked");
  const mutators = isLocked(collection) ? [] : ["set", "add", "delete", "clear"].filter((name) => name in collection);
  for (const name of mutators) Object.defineProperty(collection, name, { value: refuseChange });
  for (const entry of collection.values()) deepFreeze(entry, seen);
}

// WHY: a parsed revision is shared by every request, so nothing may change it once it is read. `seen`, not
// Object.isFrozen, ends a cycle: a parent frozen elsewhere may still hold a writable child.
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  if (value instanceof Map || value instanceof Set) lockEntries(value, seen);
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key], seen);
  return value;
}
