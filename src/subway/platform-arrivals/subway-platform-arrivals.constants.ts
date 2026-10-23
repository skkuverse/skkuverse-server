// WHY: older than this, the tracker has stopped writing (both upstreams down, or no poller), so the route
// serves the timetable alone.
export const MAX_STATE_AGE_MS = 2 * 60_000;
