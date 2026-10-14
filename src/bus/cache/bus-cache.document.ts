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

export interface JongroArrivalDoc {
  stationId: string;
  sequence: string;
  stationName: string;
  carNumber: string;
  eventDate: string;
  stationNumber: string;
  eta: string;
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
