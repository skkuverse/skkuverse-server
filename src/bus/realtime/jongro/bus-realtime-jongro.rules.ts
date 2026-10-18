import type { BusCacheKey } from "../../cache/bus-cache.document";
import { DWELL_RESET_MINUTES, MAX_STATIONARY_MOVE_METERS } from "./bus-realtime-jongro.constants";
import type { JongroBusDwell, JongroBusSighting, JongroVehicleObservation } from "./bus-realtime-jongro.types";

const ORIGIN_SECT_ORD = 1;

export function toArrivalsKey(code: string): BusCacheKey & `jongro_stations_${string}` {
  return `jongro_stations_${code}`;
}

export function toPositionsKey(code: string): BusCacheKey & `jongro_locations_${string}` {
  return `jongro_locations_${code}`;
}

// QUIRK(topis): "0" is data and "4" no result (overnight); any other code is an upstream error.
export function isUsableHeaderCd(headerCd: string | undefined): boolean {
  return !headerCd || headerCd === "0" || isNoResultHeaderCd(headerCd);
}

export function isNoResultHeaderCd(headerCd: string | undefined): boolean {
  return headerCd === "4";
}

// QUIRK(topis): numbers arrive as strings; anything else is not a number.
export function toTopisInteger(text: string | null | undefined): number | null {
  const trimmed = text?.trim() ?? "";
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : null;
}

// WHY: TOPIS gives no arrival time, so a bus's time at its last passed station counts from the first tick that
// saw a bus there; the dwell is per station, not per bus.
export function toDwell(firstSeenAt: string | undefined, now: Date): JongroBusDwell {
  const minutesHeld = firstSeenAt ? (now.getTime() - new Date(firstSeenAt).getTime()) / 1000 / 60 : 0;
  if (!firstSeenAt || minutesHeld > DWELL_RESET_MINUTES) return { firstSeenAt: now.toISOString(), dwellSeconds: 0 };
  return { firstSeenAt, dwellSeconds: Math.round((now.getTime() - new Date(firstSeenAt).getTime()) / 1000) };
}

export function toTopisDecimal(text: string | null | undefined): number | null {
  const trimmed = text?.trim() ?? "";
  return /^\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) : null;
}

// QUIRK(topis): dataTm is a KST wall clock, yyyyMMddHHmmss, with no offset.
export function toObservedAt(dataTm: string | null | undefined): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(dataTm?.trim() ?? "");
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
}

// WHY: TOPIS repeats an observation across polls, so only an advanced observation time is new evidence;
// sectDist comes in km with three decimals, compared in whole meters.
export function isStationary(
  previous: JongroVehicleObservation | undefined,
  current: Omit<JongroVehicleObservation, "isStationary">,
): boolean {
  if (!previous || previous.sectOrd !== current.sectOrd) return false;
  if (Date.parse(current.observedAt) <= Date.parse(previous.observedAt)) return previous.isStationary;
  return toMovedMeters(previous, current) < MAX_STATIONARY_MOVE_METERS;
}

// WHY: TOPIS stops advancing dataTm for a bus idling at its origin, so a repeated observation counts as not moved;
// lastStTm 0 is the origin (EVIDENCE: 148 of 148 rows at sectOrd 1 on 2026-10-17, 0 of 969 elsewhere).
export function isIdlingAtOrigin(
  previous: JongroVehicleObservation | undefined,
  current: Pick<JongroBusSighting, "sectOrd" | "sectDist" | "isAtStop" | "lastStTm">,
): boolean {
  if (current.sectOrd !== ORIGIN_SECT_ORD || current.lastStTm !== 0) return false;
  if (!previous) return !current.isAtStop;
  return previous.sectOrd === current.sectOrd && toMovedMeters(previous, current) < MAX_STATIONARY_MOVE_METERS;
}

// WHY: an atStop bus's dwell counts from the first observation at its stop, so its departure is not reset each tick.
export function toAtStopSince(
  previous: JongroVehicleObservation | undefined,
  current: Pick<JongroBusSighting, "sectOrd" | "isAtStop" | "observedAt">,
): string | undefined {
  if (!current.isAtStop) return undefined;
  return previous?.sectOrd === current.sectOrd && previous.atStopSince ? previous.atStopSince : current.observedAt;
}

function toMovedMeters(previous: Pick<JongroVehicleObservation, "sectDist">, current: Pick<JongroVehicleObservation, "sectDist">): number {
  return Math.round(Math.abs(current.sectDist - previous.sectDist) * 1000);
}
