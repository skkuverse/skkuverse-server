import { STOP_SERVICE_IDS_BY_GROUP_ID } from "../bus.constants";

export const SKKU_GREEN = "003626";
export const HAKBU_BLUE = "1565C0";
export const FASTTRACK_ORANGE = "E65100";

export const CAMPUS_SERVICE_IDS = STOP_SERVICE_IDS_BY_GROUP_ID.campus;

// WHY: the groups the bus-stops dataset feeds besides the Jongro groups: the HSSC line, and the shuttles' stops and sequences.
export const STOP_GROUP_IDS: readonly string[] = ["hssc", "campus", "commute"];

export const COMMUTE_SERVICE_IDS = STOP_SERVICE_IDS_BY_GROUP_ID.commute;

// WHY: what each source can never supply, so a null on the live route means unknown now (ADR 0019, D2); the HSSC line
// is a loop whose trajectories pass the last index, and Jongno 02 repeats its terminal instead (D7).
export const HSSC_LIVE_SCREEN = {
  isLoop: true,
  capabilities: { positionSource: "stopEvents", occupancy: false, plateNumber: false, lastBus: false, lowFloor: false },
} as const;

export const JONGRO_LIVE_SCREEN = {
  isLoop: false,
  capabilities: { positionSource: "gps", occupancy: true, plateNumber: true, lastBus: true, lowFloor: true },
} as const;
