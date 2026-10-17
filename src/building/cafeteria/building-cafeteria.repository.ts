import { Injectable } from "@nestjs/common";
import type { AnyBulkWriteOperation, BulkWriteResult, Collection } from "mongodb";
import config from "../../infra/config";
import { mongoCollection } from "../../infra/mongo";
import type { CafeteriaDoc, SyncedCafeteria } from "./building-cafeteria.document";

// WHY: keyed by SKKU's conspaceCd, so a rerun converges; `_id` needs no index of its own.
@Injectable()
export class BuildingCafeteriaRepository {
  upsertCafeterias(cafeterias: readonly SyncedCafeteria[], syncStartedAt: Date): Promise<BulkWriteResult> {
    const ops: AnyBulkWriteOperation<CafeteriaDoc>[] = cafeterias.map(({ _id, ...fields }) => ({
      updateOne: {
        filter: { _id },
        update: { $set: { ...fields, syncedAt: syncStartedAt } },
        upsert: true,
      },
    }));
    return this.facilities().bulkWrite(ops, { ordered: false });
  }

  async deleteCafeteriasSyncedBefore(syncStartedAt: Date): Promise<number> {
    const deleteResult = await this.facilities().deleteMany({ kind: "cafeteria", syncedAt: { $lt: syncStartedAt } });
    return deleteResult.deletedCount;
  }

  private facilities(): Collection<CafeteriaDoc> {
    return mongoCollection<CafeteriaDoc>(config.building.dbName, config.building.collections.facilities);
  }
}
