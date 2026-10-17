// WHY: every replica reads a change within a minute: the poller clears its own copy, the others expire theirs.
export const REGISTRY_TTL_MS = 30_000;

// WHY: three ticks of the 40 s poller agreeing on a list, so one odd answer never rewrites the stations.
export const OBSERVATIONS_TO_APPLY = 3;

// WHY: a change to more than this share of the stops reads as a wrong answer (another route's list), not a reroute.
export const MAX_CHANGED_SHARE_TO_APPLY = 0.3;

export const STATIONS_VERSION_LENGTH = 16;
