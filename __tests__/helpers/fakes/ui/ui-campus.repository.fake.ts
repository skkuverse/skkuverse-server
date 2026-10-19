/**
 * In-memory UiCampusRepository: the content database's `datasets`, one
 * document per dataset name. findCampusBanners reads as the real read does
 * (pinned in src/ui/campus/ui-campus.repository.spec.ts): the `campus-banners`
 * document's revision and data only, parsed with the same schema, so a missing
 * or invalid document reads as `null`. `storeCampusBanners` stores data
 * unchecked at the next revision, as `npm run data` would without its checks,
 * so a test can seed an invalid one. `failWith` makes the next reads reject, as
 * a database error would, wrapped in UiCampusBannersReadError as the real read
 * wraps it; `readCount` counts the reads that reached the store.
 */
import { CAMPUS_BANNERS_DATASET } from "../../../../src/ui/campus/ui-campus.constants";
import { UiCampusBannersReadError } from "../../../../src/ui/campus/ui-campus.error";
import type { UiCampusRepository } from "../../../../src/ui/campus/ui-campus.repository";
import { storedCampusBanners } from "../../../../src/ui/campus/ui-campus.schema";
import type { CampusBannersRevision } from "../../../../src/ui/campus/ui-campus.types";
import type { PublicOf } from "../public-of";

export class FakeUiCampusRepository implements PublicOf<UiCampusRepository> {
  datasets = new Map<string, { revision: unknown; data: unknown }>();
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `campus-banners`, unchecked, and returns that revision. */
  storeCampusBanners(data: unknown): number {
    const current = this.datasets.get(CAMPUS_BANNERS_DATASET);
    const revision = typeof current?.revision === "number" ? current.revision + 1 : 1;
    this.datasets.set(CAMPUS_BANNERS_DATASET, { revision, data: structuredClone(data) });
    return revision;
  }

  async findCampusBanners(): Promise<CampusBannersRevision | null> {
    if (this.failWith) throw new UiCampusBannersReadError(this.failWith);
    this.readCount += 1;
    const doc = this.datasets.get(CAMPUS_BANNERS_DATASET);
    if (doc === undefined) return null;
    const parsed = storedCampusBanners.safeParse(structuredClone({ revision: doc.revision, data: doc.data }));
    return parsed.success ? { revision: parsed.data.revision, banners: parsed.data.data } : null;
  }
}
