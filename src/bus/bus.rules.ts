import type { UpstreamFailure } from "../infra/types";
import { isRecord } from "../shared/object.util";
import { ARS_ID_PATTERN, SERVICE_CONFIG } from "./bus.constants";
import type { ServiceConfigEntry, StopAliases, StopAreaMembership, TopisAnswer } from "./bus.types";

const AUTH_STATUSES: ReadonlySet<number> = new Set([401, 403]);
const TOO_MANY_REQUESTS_STATUS = 429;
const QUOTA_CODE_NAME = "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR";
// QUIRK(topis): data.go.kr refuses a key's spent daily quota as code 22 LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR,
// in its own XML or JSON envelope (data.go.kr 15000314's error table, 2026-10-24); which one ws.bus.go.kr relays is
// unseen, so any text of the answer is read. Code 23, the per-second limit, is not the daily quota.
const QUOTA_CODE_PATTERN = /LIMITED[ _]NUMBER[ _]OF[ _]SERVICE[ _]REQUESTS[ _]EXCEEDS|"headerCd":"22"|<returnReasonCode>22</;
// QUIRK(topis): since 2026-11-03 a gateway in front refuses a missing or unknown key as a 401 JSON `{ error, message,
// status }`; how it refuses a spent quota is unseen, so a 429 or its words for a limit count as the quota.
const GATEWAY_LIMIT_PATTERN = /한도|초과|limit|quota|too many requests/i;

// WHY: a refused key is the one failure its owner acts on, so a 401 or 403 is one only in the gateway's own JSON.
export function toTopisFailure({ body, status, reason, timedOut }: TopisAnswer): UpstreamFailure | null {
  if (timedOut) return { kind: "timeout" };
  const refusal = toGatewayRefusal(body);
  const quotaMessage = toQuotaMessage(body, status, refusal);
  if (quotaMessage !== null) return { kind: "quota", message: quotaMessage };
  if (status !== undefined && AUTH_STATUSES.has(status) && refusal) return { kind: "auth", status, message: refusal.message };
  if (status !== undefined) return { kind: "outage", status };
  return reason === undefined ? null : { kind: "outage", reason };
}

function toGatewayRefusal(body: unknown): { error: string; message: string } | null {
  if (!isRecord(body) || typeof body.error !== "string") return null;
  return { error: body.error, message: typeof body.message === "string" ? body.message : body.error };
}

function toQuotaMessage(body: unknown, status: number | undefined, refusal: { error: string; message: string } | null): string | null {
  if (QUOTA_CODE_PATTERN.test(typeof body === "string" ? body : (JSON.stringify(body) ?? ""))) return QUOTA_CODE_NAME;
  const isLimit = status === TOO_MANY_REQUESTS_STATUS || (refusal !== null && GATEWAY_LIMIT_PATTERN.test(`${refusal.error} ${refusal.message}`));
  if (!isLimit) return null;
  return refusal?.message ?? "Too Many Requests";
}

export function toTopisFailureMessage({ kind, ...fields }: UpstreamFailure, what: string): string {
  return `TOPIS ${kind} (${[what, ...Object.values(fields)].join(", ")})`;
}

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

/** WHY: the stop a TOPIS pole is: the local stop aliasing its ARS number, else its national station id; a virtual stop is none. */
export function toPoleStopId({ arsId, topisId }: { arsId: string | null; topisId: string }, stopIdByArsId: ReadonlyMap<string, string>): string | null {
  const poleArsId = toServedArsId(arsId);
  if (poleArsId === null) return null;
  return stopIdByArsId.get(poleArsId) ?? topisId;
}

// WHY: a TOPIS station's stop: the local stop aliasing its station id, else its ARS number, else its pole's own; a
// route /bus/config does not list names only an aliased pole, so it adds no stop of its own (ADR 0019, D5).
export function toStationStopId(station: { arsId: string | null; topisId: string }, aliases: StopAliases, isListed: boolean): string | null {
  const servedArsId = toServedArsId(station.arsId);
  const aliasedStopId = aliases.stopIdByTopisId.get(station.topisId) ?? (servedArsId === null ? undefined : aliases.stopIdByArsId.get(servedArsId));
  if (aliasedStopId !== undefined) return aliasedStopId;
  return isListed ? toPoleStopId(station, aliases.stopIdByArsId) : null;
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
