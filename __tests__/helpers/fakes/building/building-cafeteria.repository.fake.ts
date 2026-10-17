/**
 * In-memory BuildingCafeteriaRepository over `facilities`, following the real
 * repository's write rules (pinned in building-cafeteria.repository.spec.ts):
 * upsertCafeterias replaces each cafeteria's fields by its conspaceCd and stamps
 * `syncedAt`; deleteCafeteriasSyncedBefore deletes the cafeterias stamped
 * before the cutoff and counts them.
 */
import type { BulkWriteResult } from "mongodb";
import type { CafeteriaDoc, SyncedCafeteria } from "../../../../src/building/cafeteria/building-cafeteria.document";
import type { BuildingCafeteriaRepository } from "../../../../src/building/cafeteria/building-cafeteria.repository";
import type { PublicOf } from "../public-of";

export class FakeBuildingCafeteriaRepository implements PublicOf<BuildingCafeteriaRepository> {
  cafeterias = new Map<string, CafeteriaDoc>();

  async upsertCafeterias(cafeterias: readonly SyncedCafeteria[], syncStartedAt: Date): Promise<BulkWriteResult> {
    let upserted = 0;
    for (const cafeteria of cafeterias) {
      if (!this.cafeterias.has(cafeteria._id)) upserted++;
      this.cafeterias.set(cafeteria._id, { ...cafeteria, syncedAt: syncStartedAt });
    }
    return { matchedCount: cafeterias.length - upserted, upsertedCount: upserted } as unknown as BulkWriteResult;
  }

  async deleteCafeteriasSyncedBefore(syncStartedAt: Date): Promise<number> {
    let deleted = 0;
    for (const [id, cafeteria] of this.cafeterias) {
      if (cafeteria.syncedAt < syncStartedAt) {
        this.cafeterias.delete(id);
        deleted++;
      }
    }
    return deleted;
  }
}
