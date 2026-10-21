import { STOP_SERVICE_IDS_BY_GROUP_ID } from "../bus.constants";

export const SKKU_GREEN = "003626";
export const HAKBU_BLUE = "1565C0";
export const FASTTRACK_ORANGE = "E65100";

export const CAMPUS_SERVICE_IDS = STOP_SERVICE_IDS_BY_GROUP_ID.campus;

// WHY: the groups the bus-stops dataset feeds: the HSSC line, and the shuttles' stops and sequences.
export const STOP_GROUP_IDS: readonly string[] = ["hssc", "campus", "commute"];

export const COMMUTE_SERVICE_IDS = STOP_SERVICE_IDS_BY_GROUP_ID.commute;
