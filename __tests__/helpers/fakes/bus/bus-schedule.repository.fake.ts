/**
 * In-memory BusScheduleRepository with the real reads' filters (pinned in
 * bus-schedule.repository.spec.ts): a service's patterns, and its overrides
 * from one date to another inclusive. `reads` counts the reads, as a cache
 * test needs; `failWith` makes every read reject.
 */
import type { BusOverrideDoc, BusScheduleDoc } from "../../../../src/bus/schedule/bus-schedule.document";
import type { BusScheduleRepository } from "../../../../src/bus/schedule/bus-schedule.repository";
import type { PublicOf } from "../public-of";

export class FakeBusScheduleRepository implements PublicOf<BusScheduleRepository> {
  patterns: BusScheduleDoc[] = [];
  overrides: BusOverrideDoc[] = [];
  reads = 0;
  failWith: Error | null = null;

  async onModuleInit(): Promise<void> {}

  async listPatterns(serviceId: string): Promise<BusScheduleDoc[]> {
    this.read();
    return this.patterns.filter((p) => p.serviceId === serviceId);
  }

  async listOverrides(serviceId: string, from: string, until: string): Promise<BusOverrideDoc[]> {
    this.read();
    return this.overrides.filter((o) => o.serviceId === serviceId && o.date >= from && o.date <= until);
  }

  private read(): void {
    this.reads += 1;
    if (this.failWith) throw this.failWith;
  }
}
