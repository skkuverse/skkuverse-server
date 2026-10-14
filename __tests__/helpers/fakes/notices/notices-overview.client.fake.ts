/**
 * NoticesOverviewClient with a scripted outcome, already in the result the real client translates the ai's
 * answer into (notices-overview.client.spec.ts covers that). `requests` records every request, in order.
 */
import type { NoticesOverviewClient } from "../../../../src/notices/overview/notices-overview.client";
import type { AiOverviewRequest, AiOverviewResult } from "../../../../src/notices/overview/notices-overview.types";
import type { PublicOf } from "../public-of";

export class FakeNoticesOverviewClient implements PublicOf<NoticesOverviewClient> {
  outcome: AiOverviewResult = { kind: "failed", httpStatus: null, code: "unscripted" };
  requests: AiOverviewRequest[] = [];

  async postOverview(body: AiOverviewRequest): Promise<AiOverviewResult> {
    this.requests.push(body);
    return this.outcome;
  }
}
