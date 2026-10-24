/** WHY: one bus's seats left as GBIS answered them; null when GBIS said it does not know. */
export interface VehicleSeats {
  /** QUIRK(gbis): GBIS's vehId, the same id TOPIS gives the bus, so the live route's vehicle.id. */
  vehicleId: string;
  seatsLeft: number | null;
}

/**
 * WHY: `bus_seats`, one document per route keyed by its id, which the seat poller overwrites at each answer. Not a bus_cache
 * key: that collection's TTL drops a key a minute after its write, sooner than this poller's 90 s tick.
 */
export interface BusSeatsDocument {
  _id: string;
  seats: VehicleSeats[];
  /** WHY: when this server got the answer, which the reader's freshness bound is measured from. */
  checkedAt: Date;
}
