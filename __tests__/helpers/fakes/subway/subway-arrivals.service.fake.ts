/**
 * SubwayArrivalsService for a journey door: `callsByPlatform` holds the calls a station board serves at each platform,
 * which listPlatformCalls returns as they are (none for a platform it does not hold); `reads` lists the platforms
 * asked for. How the real service builds them from the stored state is subway-arrivals.service.spec.ts's; it serves
 * no station board.
 */
import type { StopCall } from "../../../../src/shared/call.types";
import type { SubwayArrivalsService } from "../../../../src/subway/arrivals/subway-arrivals.service";
import type { PublicOf } from "../public-of";

export class FakeSubwayArrivalsService implements PublicOf<SubwayArrivalsService> {
  callsByPlatform = new Map<string, StopCall[]>();
  reads: string[] = [];

  async findStationArrivals(): Promise<null> {
    return null;
  }

  async listPlatformCalls(platformId: string): Promise<StopCall[]> {
    this.reads.push(platformId);
    return this.callsByPlatform.get(platformId) ?? [];
  }
}
