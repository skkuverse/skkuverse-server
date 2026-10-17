import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { CAMPUSES } from "../building.constants";
import { BuildingCafeteriaClient } from "./building-cafeteria.client";
import type { SyncedCafeteria } from "./building-cafeteria.document";
import { BuildingCafeteriaRepository } from "./building-cafeteria.repository";
import { shouldDeleteStaleCafeterias } from "./building-cafeteria.rules";

@Injectable()
export class BuildingCafeteriaService {
  constructor(
    private readonly client: BuildingCafeteriaClient,
    private readonly repository: BuildingCafeteriaRepository,
    private readonly clock: Clock,
  ) {}

  // WHY: logs no failure itself; the poller registry reports the rejection. Every campus is fetched
  // before the first write, so a failed fetch writes nothing.
  async run(): Promise<void> {
    const syncStartedAt = this.clock.now();
    const cafeterias = await this.fetchCafeterias();
    if (cafeterias.length === 0) {
      throw new Error("sisulList listed no cafeteria; nothing written");
    }
    const { upsertedCount } = await this.repository.upsertCafeterias(cafeterias, syncStartedAt);
    const deleted = await this.deleteStaleCafeterias(cafeterias.length, syncStartedAt);
    logger.info(
      { event: "building.cafeteria.sync_completed", cafeterias: cafeterias.length, upserted: upsertedCount, deleted },
      "Cafeteria sync complete",
    );
  }

  private async fetchCafeterias(): Promise<SyncedCafeteria[]> {
    const cafeterias: SyncedCafeteria[] = [];
    for (const campus of CAMPUSES) {
      cafeterias.push(...(await this.client.fetchCafeterias(campus)));
    }
    return cafeterias;
  }

  private async deleteStaleCafeterias(listedCount: number, syncStartedAt: Date): Promise<number> {
    if (!shouldDeleteStaleCafeterias(listedCount)) {
      logger.warn(
        { event: "building.cafeteria.stale_delete_skipped", count: listedCount },
        "Too few cafeterias listed to trust, skipping stale delete",
      );
      return 0;
    }
    return this.repository.deleteCafeteriasSyncedBefore(syncStartedAt);
  }
}
