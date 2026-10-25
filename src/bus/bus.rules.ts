import { ARS_ID_PATTERN, SERVICE_CONFIG, TOPIS_STOP_ID_PREFIX } from "./bus.constants";
import type { ServiceConfigEntry, StopAliases, StopAreaMembership } from "./bus.types";

// WHY: own keys only, so a service id that names an Object.prototype member (`toString`) is unknown.
export function serviceConfigOf(serviceId: string): ServiceConfigEntry | undefined {
  return Object.hasOwn(SERVICE_CONFIG, serviceId) ? SERVICE_CONFIG[serviceId] : undefined;
}

// QUIRK(hssc): the two passes of the Hyehwa Rotary (seq 10 and 1), where the shuttle boards no one; the stored line
// names no stop at these positions, and the HSSC estimates count neither as a stop.
const HSSC_PASS_THROUGH_STATION_INDEXES: readonly number[] = [5, 7];

export function isHsscPassThrough(stationIndex: number): boolean {
  return HSSC_PASS_THROUGH_STATION_INDEXES.includes(stationIndex);
}

// QUIRK(topis): a station a bus passes without stopping is named `…(미정차)` on every row (7800, captured 2026-10-24), the
// one mark it always carries: its ARS number is 0 on most, but a five-digit number on three of 7800's 19.
const PASS_THROUGH_NAME_SUFFIX = "(미정차)";

export function isTopisPassThrough(stationName: string): boolean {
  return stationName.trim().endsWith(PASS_THROUGH_NAME_SUFFIX);
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

// QUIRK(topis): a virtual stop carries the ARS number 0 or none, and no pole stands there.
export function toServedArsId(arsId: string | null): string | null {
  return arsId !== null && ARS_ID_PATTERN.test(arsId) && Number(arsId) !== 0 ? arsId : null;
}

/** WHY: the stop a TOPIS pole is: the local stop aliasing its ARS number, else `seoul-<arsId>`; a virtual stop is none. */
export function toPoleStopId(arsId: string | null, stopIdByArsId: ReadonlyMap<string, string>): string | null {
  const poleArsId = toServedArsId(arsId);
  if (poleArsId === null) return null;
  return stopIdByArsId.get(poleArsId) ?? `${TOPIS_STOP_ID_PREFIX}${poleArsId}`;
}

// WHY: a TOPIS station's stop: the local stop aliasing its station id, else its ARS number, else its pole's own; a
// route /bus/config does not list names only an aliased pole, so it adds no `seoul-` stop (ADR 0019, D5).
export function toStationStopId({ arsId, topisId }: { arsId: string | null; topisId: string }, aliases: StopAliases, isListed: boolean): string | null {
  const servedArsId = toServedArsId(arsId);
  const aliasedStopId = aliases.stopIdByTopisId.get(topisId) ?? (servedArsId === null ? undefined : aliases.stopIdByArsId.get(servedArsId));
  if (aliasedStopId !== undefined) return aliasedStopId;
  return isListed ? toPoleStopId(arsId, aliases.stopIdByArsId) : null;
}

/** WHY: each stop's area, held by the first area that lists it (ADR 0022, D4); a member is left out when it is no stop or a held one. */
export function toStopAreaMembership(stopAreas: ReadonlyArray<{ id: string; stopIds: readonly string[] }>, stopIdOf: (memberId: string) => string | null): StopAreaMembership {
  const membership: StopAreaMembership = { stopAreaIdByStopId: new Map(), heldMembers: [], leftOutMembers: [] };
  stopAreas.forEach(({ id, stopIds }, areaIndex) =>
    stopIds.forEach((memberId, memberIndex) => {
      const stopId = stopIdOf(memberId);
      const heldBy = stopId === null ? null : (membership.stopAreaIdByStopId.get(stopId) ?? null);
      if (stopId === null || heldBy !== null) {
        membership.leftOutMembers.push({ stopAreaId: id, areaIndex, memberIndex, memberId, stopId, heldBy });
        return;
      }
      membership.stopAreaIdByStopId.set(stopId, id);
      membership.heldMembers.push({ areaIndex, memberIndex, stopId });
    }),
  );
  return membership;
}

/** WHY: the next station of the HSSC loop a rider can get off at; its next position can be a rotary pass. */
export function toTowards(line: ReadonlyArray<{ name: string; stopId: string | null }>, stationIndex: number): string | null {
  for (let ahead = 1; ahead < line.length; ahead++) {
    const station = line[(stationIndex + ahead) % line.length];
    if (station?.stopId) return station.name;
  }
  return null;
}

// WHY: riders may only get off at an HSSC drop-off-only station; they board at every other, and on every Jongno route.
export function toStationAction(station: { isAlightOnly?: boolean } | undefined): "board" | "alight" {
  return station?.isAlightOnly ? "alight" : "board";
}
