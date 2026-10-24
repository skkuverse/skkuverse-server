import { Injectable } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { createLogThrottle } from "../../../infra/log-throttle";
import logger from "../../../infra/logger";
import { REGIONAL_ROUTES } from "../../bus.constants";
import type { JongroRoute } from "../../bus.types";
import { BusRealtimeGbisClient } from "./bus-realtime-gbis.client";
import type { BusSeatsDocument } from "./bus-realtime-gbis.document";
import { BusRealtimeGbisRepository } from "./bus-realtime-gbis.repository";
import { isFreshSeats, isInServiceWindow } from "./bus-realtime-gbis.rules";

const NO_SEATS: ReadonlyMap<string, number> = new Map();
// WHY: a database that stays unreadable would otherwise log one line per live request.
const READ_FAILED_LOG_INTERVAL_MS = 60_000;

@Injectable()
export class BusRealtimeGbisService {
  private readonly readFailedThrottle = createLogThrottle(READ_FAILED_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(
    private readonly client: BusRealtimeGbisClient,
    private readonly repository: BusRealtimeGbisRepository,
    private readonly clock: Clock,
  ) {}

  // WHY: outside the window the tick resolves without a call, so the daily quota holds (bus-realtime-gbis.constants.ts).
  async refresh(route: JongroRoute): Promise<void> {
    if (!isInServiceWindow(this.clock.now())) return;
    const seats = await this.client.fetchSeats(route);
    await this.repository.upsertSeats({ _id: route.id, seats, checkedAt: this.clock.now() });
  }

  // WHY: GBIS serves only the Gyeonggi routes, so a Jongno route reads nothing; an answer past its bound serves none.
  async findSeatsLeft(routeId: string): Promise<ReadonlyMap<string, number>> {
    if (!REGIONAL_ROUTES.some((route) => route.id === routeId)) return NO_SEATS;
    const stored = await this.findStoredSeats(routeId);
    if (!stored || !isFreshSeats(stored.checkedAt, this.clock.now())) return NO_SEATS;
    return new Map(stored.seats.flatMap(({ vehicleId, seatsLeft }) => (seatsLeft === null ? [] : [[vehicleId, seatsLeft] as const])));
  }

  // WHY: seats are an extra on the live answer, so a failed read serves none rather than failing arrivals bus_cache holds.
  private async findStoredSeats(routeId: string): Promise<BusSeatsDocument | null> {
    try {
      return await this.repository.findSeats(routeId);
    } catch (err) {
      const ticket = this.readFailedThrottle.take(routeId);
      if (ticket) logger.warn({ event: "bus.gbis.read_failed", routeId, err, suppressed: ticket.suppressed }, "bus_seats unreadable: serving no seats");
      return null;
    }
  }
}
