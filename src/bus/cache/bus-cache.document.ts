/** QUIRK(hssc): the HSSC API's own row, which the poller keeps whole in the cached bus. */
export interface HsscApiBus {
  line_no: string;
  /** QUIRK(hssc): "LEFT", "ENTERED", "EMERGENCY" or "LEFT_LAST" so far; nothing branches on it. */
  inout: string;
  stop_no: string;
  /** QUIRK(hssc): the stop's index on the circular route, "0" to "10". */
  seq: string;
  stop_name: string;
  /** QUIRK(hssc): Korean-locale local time, its AM/PM marker in Korean. */
  get_date: string;
}

export interface HsscBusDoc extends HsscApiBus {
  sequence: string;
  stationName: string;
  carNumber: string;
  eventDate: string;
  estimatedTime: number;
  isLastBus: boolean;
}

export interface JongroArrivalBus {
  /** QUIRK(topis): seconds to the stop, although TOPIS's guide says minutes; 0 when it has none. */
  traTime: number;
  sectOrd: number;
  staOrd: number;
  arrmsg: string;
  isLast: boolean;
  plainNo: string;
  /** QUIRK(topis): "0" when no bus is assigned. */
  vehId: string;
  /** QUIRK(topis): 2 makes rerideNum the on-board passenger count, 4 a congestion code. */
  rerideDiv: number | null;
  rerideNum: number | null;
}

export interface JongroArrivalDoc {
  stationId: string;
  sequence: string;
  stationName: string;
  carNumber: string;
  eventDate: string;
  stationNumber: string;
  eta: string;
  /** WHY: the row's first bus, then its second. */
  buses: JongroArrivalBus[];
}

export interface JongroBusPositionDoc {
  sequence: string;
  stationName: string;
  carNumber: string;
  eventDate: string;
  estimatedTime: number;
  stationId: string;
  latitude: string;
  longitude: string;
  recordTime: string;
  vehicleId: string;
  /** QUIRK(topis): km into the section toward the next stop, three decimals. */
  sectDist: number;
  /** QUIRK(topis): the section's length in km. */
  fullSectDist: number;
  isAtStop: boolean;
  /** WHY: TOPIS's observation time as an ISO-8601 instant at +09:00. */
  observedAt: string;
  /** WHY: the vehicle stood still since the poller's previous observation of it. */
  isStationary: boolean;
  atStopSince?: string;
}

export interface BusCacheValueByKey {
  hssc: HsscBusDoc[];
  station: string;
  [key: `jongro_stations_${string}`]: JongroArrivalDoc[];
  [key: `jongro_locations_${string}`]: JongroBusPositionDoc[];
}

export type BusCacheKey = keyof BusCacheValueByKey & string;

export interface BusCacheDocument {
  _id: string;
  data: BusCacheValueByKey[BusCacheKey];
  _updatedAt: Date;
}
