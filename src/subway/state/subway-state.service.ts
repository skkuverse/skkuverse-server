import { Injectable } from "@nestjs/common";
import type { SubwayArrivalsDoc } from "../subway.document";
import { SubwayRepository } from "../subway.repository";
import { isArrivalsWriteDue } from "./subway-state.rules";

// WHY: Atlas bills by peak ops/s, and most ticks change few platforms (design D10). The last written documents
// live in the poller process's memory, so a restart writes every platform on its first tick; a document is
// remembered only once its write resolved, so a failed one is written again on the next tick.
@Injectable()
export class SubwayStateService {
  private readonly lastWrittenByPlatformId = new Map<string, SubwayArrivalsDoc>();

  constructor(private readonly repository: SubwayRepository) {}

  async writeArrivals(docs: readonly SubwayArrivalsDoc[]): Promise<void> {
    const due = docs.filter((doc) => isArrivalsWriteDue(this.lastWrittenByPlatformId.get(doc._id), doc));
    await this.repository.upsertArrivals(due);
    for (const doc of due) this.lastWrittenByPlatformId.set(doc._id, doc);
  }
}
