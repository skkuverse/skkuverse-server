export const SKKU_GREEN = "003626";
export const HAKBU_BLUE = "1565C0";
export const FASTTRACK_ORANGE = "E65100";

export const CAMPUS_SERVICE_IDS = ["campus-inja", "campus-jain"] as const;

// WHY: the groups the bus-stops dataset feeds: the HSSC line, and the shuttles' stops and sequences.
export const STOP_GROUP_IDS: readonly string[] = ["hssc", "campus", "commute"];

export const COMMUTE_SERVICE_IDS = [
  "commute-jeongja",
  "commute-jamsil",
  "commute-dogok",
  "commute-gangnam-yangjae",
  "commute-gwanggyo",
] as const;
