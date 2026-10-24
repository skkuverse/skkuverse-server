/**
 * In-memory BusRealtimeGbisRepository: one seats document per route id, replaced whole as the real replaceOne does,
 * or every write rejects with `failWith` and every read with `readFailWith`; `reads` counts the finds.
 */
import type { BusSeatsDocument } from "../../../../src/bus/realtime/gbis/bus-realtime-gbis.document";
import type { BusRealtimeGbisRepository } from "../../../../src/bus/realtime/gbis/bus-realtime-gbis.repository";
import type { PublicOf } from "../public-of";

export class FakeBusRealtimeGbisRepository implements PublicOf<BusRealtimeGbisRepository> {
  seatsByRouteId = new Map<string, BusSeatsDocument>();
  failWith: Error | null = null;
  readFailWith: Error | null = null;
  reads = 0;

  async upsertSeats(seats: BusSeatsDocument): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.seatsByRouteId.set(seats._id, seats);
  }

  async findSeats(routeId: string): Promise<BusSeatsDocument | null> {
    this.reads += 1;
    if (this.readFailWith) throw this.readFailWith;
    return this.seatsByRouteId.get(routeId) ?? null;
  }
}
