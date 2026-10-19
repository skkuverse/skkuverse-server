import crypto from "crypto";
import { MAX_CHANGED_SHARE_TO_APPLY, OBSERVATIONS_TO_APPLY, STATIONS_VERSION_LENGTH } from "./bus-registry.constants";
import type { ArrivalRowStation, BootstrapDecision, BootstrapObservation, MovedStation, ObservedStation, RenamedStation, StationAt, StationDiff, SyncDecision, SyncObservation } from "./bus-registry.types";

// WHY: a station's sequence is its index, so the order alone carries it and the hash leaves it out.
export function toStationsVersion(stations: readonly ObservedStation[], turnaroundTopisId: string): string {
  const canonical = JSON.stringify([stations.map((s) => [s.topisId, s.arsId, s.stationName]), turnaroundTopisId]);
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, STATIONS_VERSION_LENGTH);
}

// QUIRK(topis): the arrival list names every stop of the route on every tick, each row with its ord.
export function toObservedStations(rows: readonly ArrivalRowStation[]): ObservedStation[] {
  return [...rows]
    .sort((a, b) => Number(a.sequence) - Number(b.sequence))
    .map((row) => ({ topisId: row.stationId, arsId: row.stationNumber, stationName: row.stationName }));
}

// QUIRK(topis): each position row names the route's turnaround stop (`trnstnid`); no bus running names none, and a
// row without one is no observation.
export function toAgreedTurnaroundTopisId(sightingTurnaroundIds: ReadonlyArray<string | undefined>): string | null {
  const [first] = sightingTurnaroundIds;
  const isAgreed = first !== undefined && first !== "" && sightingTurnaroundIds.every((id) => id === first);
  return isAgreed ? first : null;
}

export function toTurnaroundTopisId(sightingTurnaroundIds: ReadonlyArray<string | undefined>, storedTopisId: string): string {
  return toAgreedTurnaroundTopisId(sightingTurnaroundIds) ?? storedTopisId;
}

// WHY: a guessed turnaround stop would be stored as if known, so only a running bus bootstraps a route.
export function toBootstrapDecision({ stations, turnaroundTopisId, pending }: BootstrapObservation): BootstrapDecision {
  if (stations.length === 0 || turnaroundTopisId === null) return { kind: "skip" };
  const stationsVersion = toStationsVersion(stations, turnaroundTopisId);
  const count = pending?.stationsVersion === stationsVersion ? pending.count + 1 : 1;
  return count < OBSERVATIONS_TO_APPLY ? { kind: "pending", pending: { stationsVersion, count } } : { kind: "insert", stationsVersion, turnaroundTopisId };
}

function toCommonOrderLength(stored: readonly string[], observed: readonly string[]): number {
  let previous = new Array<number>(observed.length + 1).fill(0);
  for (const id of stored) {
    const current = [0];
    observed.forEach((other, j) => current.push(id === other ? (previous[j] ?? 0) + 1 : Math.max(previous[j + 1] ?? 0, current[j] ?? 0)));
    previous = current;
  }
  return previous[observed.length] ?? 0;
}

// WHY: the stops of the longer list outside the two lists' longest common order, so one stop added mid-route counts
// once, not for every stop after it; a rename changes no stop (improve-jongro-realtime D9).
export function toChangedShare(stored: readonly ObservedStation[], observed: readonly ObservedStation[]): number {
  const longer = Math.max(stored.length, observed.length);
  if (longer === 0) return 0;
  const common = toCommonOrderLength(stored.map((s) => s.topisId), observed.map((s) => s.topisId));
  return (longer - common) / longer;
}

interface KeyedStation extends StationAt {
  key: string;
}

// WHY: a stop listed twice (a loop's closing repeat) is told apart by how many times it came before.
function toKeyedStations(stations: readonly ObservedStation[]): KeyedStation[] {
  const seen = new Map<string, number>();
  return stations.map((station, index) => {
    const occurrence = seen.get(station.topisId) ?? 0;
    seen.set(station.topisId, occurrence + 1);
    return { key: `${station.topisId}#${occurrence}`, ord: index + 1, topisId: station.topisId, stationName: station.stationName };
  });
}

const toStationAt = ({ ord, topisId, stationName }: KeyedStation): StationAt => ({ ord, topisId, stationName });

export function toStationDiff(stored: readonly ObservedStation[], observed: readonly ObservedStation[]): StationDiff {
  const before = toKeyedStations(stored);
  const after = toKeyedStations(observed);
  const beforeByKey = new Map(before.map((station) => [station.key, station]));
  const afterKeys = new Set(after.map((station) => station.key));
  const moved: MovedStation[] = [];
  const renamed: RenamedStation[] = [];
  for (const station of after) {
    const old = beforeByKey.get(station.key);
    if (old === undefined) continue;
    if (old.ord !== station.ord) moved.push({ fromOrd: old.ord, toOrd: station.ord, topisId: station.topisId, stationName: station.stationName });
    if (old.stationName !== station.stationName) renamed.push({ ord: station.ord, topisId: station.topisId, fromName: old.stationName, toName: station.stationName });
  }
  return {
    added: after.filter((station) => !beforeByKey.has(station.key)).map(toStationAt),
    removed: before.filter((station) => !afterKeys.has(station.key)).map(toStationAt),
    moved,
    renamed,
  };
}

export function toSyncDecision({ storedVersion, observedVersion, pending, changedShare }: SyncObservation): SyncDecision {
  if (observedVersion === storedVersion) return { kind: "unchanged" };
  const count = pending?.stationsVersion === observedVersion ? pending.count + 1 : 1;
  const next = { stationsVersion: observedVersion, count };
  if (count < OBSERVATIONS_TO_APPLY) return { kind: "pending", pending: next };
  return changedShare > MAX_CHANGED_SHARE_TO_APPLY ? { kind: "hold", pending: next } : { kind: "apply" };
}

// QUIRK(topis): some loops list their first stop again as the last ord (02: ord 1 and ord 27).
export function isLoopClosingRepeat(topisIds: readonly string[], index: number): boolean {
  return index > 0 && index === topisIds.length - 1 && topisIds[index] === topisIds[0];
}
