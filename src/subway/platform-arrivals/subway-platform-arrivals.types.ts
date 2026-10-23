import type { SubwayArrivalsDoc } from "../subway.document";
import type { SubwayPlatform } from "../subway.types";

/** WHY: a platform beside the arrivals document it is served from: its stored state while fresh, else its timetable alone. */
export interface PlatformArrivals {
  platform: SubwayPlatform;
  doc: SubwayArrivalsDoc;
}
