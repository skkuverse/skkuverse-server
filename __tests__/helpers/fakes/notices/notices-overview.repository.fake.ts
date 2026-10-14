/**
 * NoticesOverviewRepository over `candidates`, already in rank order, scoped to the requested sources as the
 * real $rankFusion is (pinned in notices-overview.query.spec.ts). `failWith` makes the read reject.
 */
import type { NoticesOverviewRepository } from "../../../../src/notices/overview/notices-overview.repository";
import type { OverviewCandidate } from "../../../../src/notices/overview/notices-overview.types";
import type { PublicOf } from "../public-of";

export class FakeNoticesOverviewRepository implements PublicOf<NoticesOverviewRepository> {
  candidates: OverviewCandidate[] = [];
  failWith: Error | null = null;

  async searchCandidates(_searchText: string, sourceIds: readonly string[]): Promise<OverviewCandidate[]> {
    if (this.failWith) throw this.failWith;
    return this.candidates.filter((candidate) => sourceIds.includes(candidate.sourceId));
  }
}
