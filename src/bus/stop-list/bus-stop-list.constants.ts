// WHY: the body holds every language and changes only with a bus-stops push or a TOPIS station or line sync.
export const STOP_LIST_CACHE_CONTROL = "public, max-age=300";

// WHY: while a registry route or a route line is unread, the poles or coordinates it leaves out return within a minute.
export const DEGRADED_STOP_LIST_CACHE_CONTROL = "public, max-age=60";

// WHY: all three Jongno routes serve the HSSC campus (owner, 2026-10-23), so a stop at one of their poles is filed under it.
export const JONGRO_POLE_CAMPUS = "hssc";
