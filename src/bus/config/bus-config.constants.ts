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

// WHY: the owner's split of the HSSC loop into its two directions (2026-10-23), by the line positions toLinearSequence
// (src/bus/realtime/hssc) fills: fromCampus from the basketball court to the first rotary pass, toCampus from Hyehwa
// Station exit 1 to the 600th Anniversary Hall.
export const HSSC_DIRECTIONS = [
  { id: "fromCampus", labelKey: "busconfig.lineDirection.fromCampus", fromIndex: 0, toIndex: 5 },
  { id: "toCampus", labelKey: "busconfig.lineDirection.toCampus", fromIndex: 6, toIndex: 10 },
] as const;

// QUIRK(topis): a direction's label wraps TOPIS's terminal name, which TOPIS has in Korean only.
export const TOWARDS_LABEL_KEY = "busconfig.lineDirection.towards";
export const TERMINAL_PLACEHOLDER = "{terminal}";

export const JONGRO_LIVE_SCREEN = {
  isLoop: false,
  capabilities: { positionSource: "gps", occupancy: true, plateNumber: true, lastBus: true, lowFloor: true },
} as const;
