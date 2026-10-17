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

/** WHY: the shape the previous poller wrote; a new replica can read one for 60 s after a deploy. */
export interface LegacyJongroArrivalDoc {
  stationId: string;
  sequence: string;
  stationName: string;
  carNumber: string;
  eventDate: string;
  stationNumber: string;
  eta: string;
}

export interface JongroArrivalDoc extends LegacyJongroArrivalDoc {
  /** WHY: the row's first bus, then its second. */
  buses: JongroArrivalBus[];
}

export type CachedJongroArrivalDoc = JongroArrivalDoc | LegacyJongroArrivalDoc;

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
}

export interface BusCacheValueByKey {
  hssc: HsscBusDoc[];
  station: string;
  [key: `jongro_stations_${string}`]: CachedJongroArrivalDoc[];
  [key: `jongro_locations_${string}`]: JongroBusPositionDoc[];
}

export type BusCacheKey = keyof BusCacheValueByKey & string;

export interface BusCacheDocument {
  _id: string;
  data: BusCacheValueByKey[BusCacheKey];
  _updatedAt: Date;
}
