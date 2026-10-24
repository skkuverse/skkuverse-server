export interface TransferLine {
  line: string;
  color: string;
}

/** WHY: what a route's source can ever supply on the live route, so a null there means unknown now (ADR 0019, D2). */
export interface JongroRouteCapabilities {
  readonly positionSource: "gps";
  readonly occupancy: boolean;
  readonly plateNumber: boolean;
  readonly lastBus: boolean;
  readonly lowFloor: boolean;
}

export interface JongroRoute {
  readonly id: string;
  /** WHY: what the pollers and bus_cache keys are named by (`jongro_stations_07`), stated, never read from the id. */
  readonly code: string;
  readonly busRouteId: string;
  readonly capabilities: JongroRouteCapabilities;
  /** WHY: an unlisted route is polled and served on /bus/live, but /bus/config lists no group for it. */
  readonly isListed: boolean;
  readonly pollIntervalMs: number;
}

export interface JongroRouteAttributes {
  readonly themeColor: string;
  readonly iconType: string;
  readonly refreshInterval: number;
  readonly seatCount: number;
  readonly transferLinesByArsId: Readonly<Record<string, ReadonlyArray<TransferLine>>>;
}

export interface ServiceConfigEntry {
  nonOperatingDayDisplay: "hidden" | "visible" | string;
  /** WHY: opt-in, so a new shuttle never loses its timetable to a holiday by default. */
  respectsKoreanHolidays?: boolean;
  /** WHY: opt-in per route type; each one's stop sequence is checked at each bus-stops push. */
  eta?: { routeTypes: string[] };
}

export type ServiceConfigMap = Record<string, ServiceConfigEntry>;
