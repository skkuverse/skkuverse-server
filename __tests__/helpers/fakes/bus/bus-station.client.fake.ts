/**
 * Scripted BusStationClient: answers the arrival messages set by the test
 * (null as TOPIS's "no result"), or rejects with `failWith`.
 */
import type { BusStationClient } from "../../../../src/bus/station/bus-station.client";
import type { PublicOf } from "../public-of";

export class FakeBusStationClient implements PublicOf<BusStationClient> {
  messages: string[] | null = null;
  failWith: Error | null = null;

  async fetchArrivalMessages(): Promise<string[] | null> {
    if (this.failWith) throw this.failWith;
    return this.messages;
  }
}
