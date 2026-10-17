export interface TransferLine {
  line: string;
  color: string;
}

export interface JongroRoute {
  readonly id: string;
  readonly code: string;
  readonly busRouteId: string;
  readonly themeColor: string;
  readonly iconType: string;
  readonly refreshInterval: number;
  readonly seatCount: number;
  readonly arrivalsUrl: string;
  readonly positionsUrl: string;
  readonly transferLinesByArsId: Readonly<Record<string, ReadonlyArray<TransferLine>>>;
}

export type ServiceKeyProblem = "missing" | "not-url-encoded";

export interface ServiceNotice {
  style: "info" | "warning" | "error" | string;
  text: string;
}

export interface ServiceConfigEntry {
  nonOperatingDayDisplay: "hidden" | "visible" | string;
  notices: ServiceNotice[];
  suspend: null | unknown;
  /** WHY: opt-in, so a new shuttle never loses its timetable to a holiday by default. */
  respectsKoreanHolidays?: boolean;
  /** WHY: opt-in per route type; each one's stop sequence is checked when the stop catalog loads. */
  eta?: { routeTypes: string[] };
}

export type ServiceConfigMap = Record<string, ServiceConfigEntry>;
