import { Injectable } from "@nestjs/common";
import type { SubwayArrivalsDoc } from "../subway.document";
import { SubwayRepository } from "../subway.repository";
import { isArrivalsWriteDue } from "./subway-state.rules";

// (An operations detail is left out of the public history.)
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
