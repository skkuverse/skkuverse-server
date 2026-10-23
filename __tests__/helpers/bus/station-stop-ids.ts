/**
 * The stop id each realtime station of `/bus/config` and
 * `/bus/config/:groupId` carries, for a test that pinned a body served before
 * the field: the HSSC positions' ids (revision 1 of `bus-stops`), and `seoul-<arsId>` of each station stored in
 * fixtures/jongro-registry-routes.json, of which none is a virtual stop and
 * none is aliased in revision 1.
 *
 * `withStationStopIds` derives the body served with the field from a pinned one by
 * appending exactly those ids, each as its station's last field, and
 * `withoutStationStopIds` removes every station's `stopId`, so a test asserts
 * both the new body and that nothing else changed. Both handle `isPassThrough`
 * the same way, served since 2026-10-23 right after `isRotationStation`: true at
 * a position with no stop id (the non-stop 혜화동로터리), false elsewhere; and `isAlightOnly`, served since
 * 2026-10-23 right after `isPassThrough`: false on every station, since revision 1 flags no position drop-off only.
 * A body's ETag is the md5 of
 * its JSON (`BusConfigService`), so `md5EtagOf` derives the new ETag too.
 */
import crypto from "crypto";
import storedRoutes from "../../nest/bus/fixtures/jongro-registry-routes.json";

/** The HSSC positions' stop ids, by station index: positions 6 and 8 (indexes 5 and 7) are the non-stop 혜화동로터리. */
export const HSSC_STOP_IDS: ReadonlyArray<string | null> = [
  "hssc-basketball-court",
  "hssc-student-center",
  "hssc-main-gate-out",
  "hssc-olympic-hall",
  "hssc-hyehwa-post-office",
  null,
  "hssc-hyehwa-exit1",
  null,
  "hssc-skku-junction",
  "hssc-main-gate-in",
  "hssc-600th-hall",
];

function jongroStopIdsOf(routeId: string): Array<string | null> {
  const route = storedRoutes.routes.find((candidate) => candidate.id === routeId);
  if (route === undefined) throw new Error(`jongro-registry-routes.json has no ${routeId}`);
  return route.stations.map(({ arsId }) => {
    if (!/^\d{5}$/.test(arsId) || Number(arsId) === 0) throw new Error(`${routeId} stores ${arsId}, which this helper does not derive`);
    return `seoul-${arsId}`;
  });
}

/** The stop id of each station of a realtime group, by index, or undefined for a group with no stations. */
export function stopIdsOfGroup(groupId: string): ReadonlyArray<string | null> | undefined {
  if (groupId === "hssc") return HSSC_STOP_IDS;
  return groupId.startsWith("jongro") ? jongroStopIdsOf(groupId) : undefined;
}

type Station = Record<string, unknown>;
type Group = { id: string; screen: { stations?: Station[] } & Record<string, unknown> } & Record<string, unknown>;

function withPassThrough(station: Station, isPassThrough: boolean): Station {
  return Object.fromEntries(Object.entries(station).flatMap((entry) => (entry[0] === "isRotationStation" ? [entry, ["isPassThrough", isPassThrough], ["isAlightOnly", false]] : [entry])));
}

/** A pinned group with its stations' stop ids appended, each last; a schedule group as it was. */
export function withStationStopIds<T>(pinned: T): T {
  const group = structuredClone(pinned) as unknown as Group;
  const stopIds = stopIdsOfGroup(group.id);
  if (stopIds === undefined || group.screen.stations === undefined) return group as unknown as T;
  if (stopIds.length !== group.screen.stations.length) throw new Error(`${group.id} pins ${group.screen.stations.length} stations, not ${stopIds.length}`);
  group.screen.stations = group.screen.stations.map((station, index) => {
    const stopId = stopIds[index];
    const flagged = withPassThrough(station, stopId === null);
    return stopId === null || stopId === undefined ? flagged : { ...flagged, stopId };
  });
  return group as unknown as T;
}

/** A body (a group or `{ groups }`) with every station's `stopId`, `isPassThrough` and `isAlightOnly` removed. */
export function withoutStationStopIds<T>(body: T): T {
  const copy = structuredClone(body) as unknown as { groups?: Group[] } & Partial<Group>;
  const groups = copy.groups ?? [copy as Group];
  for (const group of groups) {
    const stations = group.screen?.stations;
    if (stations) group.screen.stations = stations.map(({ stopId: _stopId, isPassThrough: _isPassThrough, isAlightOnly: _isAlightOnly, ...station }) => station);
  }
  return copy as unknown as T;
}

export function md5EtagOf(value: unknown): string {
  return `"${crypto.createHash("md5").update(JSON.stringify(value)).digest("hex")}"`;
}
