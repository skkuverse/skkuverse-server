/**
 * Scripted BusRoutePathClient: each TOPIS route id answers the line set for
 * it in `answers`, or rejects with `failWith`. `requestedIds` records every
 * request.
 */
import type { BusRoutePathClient } from "../../../../src/bus/route-path/bus-route-path.client";
import type { FetchedRoutePath } from "../../../../src/bus/route-path/bus-route-path.types";
import type { PublicOf } from "../public-of";

export class FakeBusRoutePathClient implements PublicOf<BusRoutePathClient> {
  answers = new Map<string, FetchedRoutePath>();
  failWith: Error | null = null;
  requestedIds: string[] = [];

  async fetchRoutePath(busRouteId: string): Promise<FetchedRoutePath> {
    this.requestedIds.push(busRouteId);
    if (this.failWith) throw this.failWith;
    const answer = this.answers.get(busRouteId);
    if (answer === undefined) throw new Error(`no scripted answer for ${busRouteId}`);
    return structuredClone(answer);
  }
}
