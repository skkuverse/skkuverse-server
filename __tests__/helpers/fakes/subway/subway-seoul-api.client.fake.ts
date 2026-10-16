/**
 * SubwaySeoulApiClient with scripted rows, already in the shape the real client
 * parses the Seoul API into (subway-seoul-api.client.spec.ts covers that). A
 * line or station with no entry answers no rows, as the API does at night; an
 * Error in its place rejects. `calls` records every request, in order.
 */
import type { SubwaySeoulApiClient } from "../../../../src/subway/seoul-api/subway-seoul-api.client";
import type { SeoulArrivalRow, SeoulPositionRow } from "../../../../src/subway/seoul-api/subway-seoul-api.schema";
import type { PublicOf } from "../public-of";

export class FakeSubwaySeoulApiClient implements PublicOf<SubwaySeoulApiClient> {
  positions = new Map<string, SeoulPositionRow[] | Error>();
  arrivals = new Map<string, SeoulArrivalRow[] | Error>();
  calls: string[] = [];

  async fetchPositions(lineName: string): Promise<SeoulPositionRow[]> {
    this.calls.push(`realtimePosition ${lineName}`);
    return this.answer(this.positions.get(lineName));
  }

  async fetchArrivals(stationName: string): Promise<SeoulArrivalRow[]> {
    this.calls.push(`realtimeStationArrival ${stationName}`);
    return this.answer(this.arrivals.get(stationName));
  }

  private answer<T>(rows: T[] | Error | undefined): T[] {
    if (rows instanceof Error) throw rows;
    return rows ?? [];
  }
}
