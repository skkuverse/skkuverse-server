/**
 * Scripted BusStationClient: answers the arrival messages set by the test
 * (empty, TOPIS's "no result", until set), or rejects with `failWith`.
 */
import type { BusStationClient } from "../../../../src/bus/station/bus-station.client";
import type { PublicOf } from "../public-of";

export class FakeBusStationClient implements PublicOf<BusStationClient> {
  messages: string[] = [];
  failWith: Error | null = null;

  async fetchArrivalMessages(): Promise<string[]> {
    if (this.failWith) throw this.failWith;
    return this.messages;
  }
}
