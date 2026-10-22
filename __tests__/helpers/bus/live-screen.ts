/**
 * The live route's fields each realtime group of `/bus/config` and `/bus/config/:groupId` carries last in its screen
 * (ADR 0019, D2, D7, D11), for a test that pinned a body served before them: `withLiveScreen` appends exactly them to a
 * pinned group, and `withoutLiveScreen` removes them from every group of a body, so a test asserts both the new body
 * and that nothing else changed.
 */
type Screen = Record<string, unknown>;
type Group = { id: string; screenType?: string; screen: Screen } & Record<string, unknown>;

const LIVE_KEYS = ["liveEndpoint", "isLoop", "capabilities"] as const;

/** The live fields of a realtime group, by its id; none for a schedule group. */
export function liveScreenOf(groupId: string): Screen | undefined {
  if (groupId === "hssc") {
    return { liveEndpoint: "/bus/live/hssc", isLoop: true, capabilities: { positionSource: "stopEvents", occupancy: false, plateNumber: false, lastBus: false } };
  }
  if (!groupId.startsWith("jongro")) return undefined;
  return { liveEndpoint: `/bus/live/${groupId}`, isLoop: false, capabilities: { positionSource: "gps", occupancy: true, plateNumber: true, lastBus: true } };
}

/** A pinned group with its live fields appended to its screen, last; a schedule group as it was. */
export function withLiveScreen<T>(pinned: T): T {
  const group = structuredClone(pinned) as unknown as Group;
  const live = liveScreenOf(group.id);
  return (live ? { ...group, screen: { ...group.screen, ...live } } : group) as unknown as T;
}

/** A body (a group or `{ groups }`) with every group's live fields removed from its screen. */
export function withoutLiveScreen<T>(body: T): T {
  const copy = structuredClone(body) as unknown as { groups?: Group[] } & Partial<Group>;
  const groups = copy.groups ?? [copy as Group];
  for (const group of groups) {
    if (group.screen) for (const key of LIVE_KEYS) delete group.screen[key];
  }
  return copy as unknown as T;
}
