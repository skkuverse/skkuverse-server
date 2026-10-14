/**
 * In-memory BusEtaRepository with the real reads' filters (pinned in
 * bus-eta.repository.spec.ts): by service and date, or unexpired at `now`;
 * the upsert keeps a frozen document with the same stop count, as the real one
 * does. `unexpiredReads` counts the serving reads; `failWith` makes every call
 * reject.
 */
import type { ShuttleEtaDoc } from "../../../../src/bus/eta/bus-eta.document";
import type { BusEtaRepository } from "../../../../src/bus/eta/bus-eta.repository";
import type { SequenceLength, UpsertResult } from "../../../../src/bus/eta/bus-eta.types";
import type { PublicOf } from "../public-of";

export class FakeBusEtaRepository implements PublicOf<BusEtaRepository> {
  docs = new Map<string, ShuttleEtaDoc>();
  unexpiredReads = 0;
  failWith: Error | null = null;

  async onModuleInit(): Promise<void> {}

  async upsertEstimates(docs: ShuttleEtaDoc[], sequenceLength: SequenceLength): Promise<UpsertResult> {
    this.fail();
    const bad = docs.find((d) => d.offsetsSec.length !== sequenceLength(d.serviceId, d.routeType));
    if (bad) throw new Error(`shuttle_eta ${bad._id}: offsets do not fit`);
    const toWrite = docs.filter((d) => this.docs.get(d._id)?.frozen !== true || this.docs.get(d._id)!.offsetsSec.length !== d.offsetsSec.length);
    for (const d of toWrite) this.docs.set(d._id, d);
    return { written: toWrite.length, skippedFrozen: docs.length - toWrite.length };
  }

  async listEstimates(serviceIds: string[], dates: string[]): Promise<ShuttleEtaDoc[]> {
    this.fail();
    return [...this.docs.values()].filter((d) => serviceIds.includes(d.serviceId) && dates.includes(d.date));
  }

  async listUnexpired(now: Date): Promise<ShuttleEtaDoc[]> {
    this.unexpiredReads += 1;
    this.fail();
    return [...this.docs.values()].filter((d) => d.expiresAt.getTime() > now.getTime());
  }

  private fail(): void {
    if (this.failWith) throw this.failWith;
  }
}
