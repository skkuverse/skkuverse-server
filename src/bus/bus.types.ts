export interface TransferLine {
  line: string;
  color: string;
}

export interface JongroRoute {
  readonly id: string;
  readonly code: string;
  readonly busRouteId: string;
}

export type JongroRouteIdentity = Pick<JongroRoute, "id" | "busRouteId">;

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
  /** WHY: opt-in per route type; each one's stop sequence is checked when the stop catalog loads. */
  eta?: { routeTypes: string[] };
}

export type ServiceConfigMap = Record<string, ServiceConfigEntry>;
