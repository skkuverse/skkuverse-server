import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { mongoCollection } from "../../infra/mongo";
import type { PublicHolidaysDoc } from "../holidays.document";
import type { PublicHoliday } from "../holidays.types";

// WHY: keyed by the year, so a rerun of the sync replaces that year instead of adding a document.
@Injectable()
export class HolidaysSyncRepository {
  async upsertYear(year: number, holidays: readonly PublicHoliday[], fetchedAt: Date): Promise<void> {
    await this.publicHolidays().updateOne({ _id: year }, { $set: { holidays: [...holidays], fetchedAt } }, { upsert: true });
  }

  private publicHolidays(): Collection<PublicHolidaysDoc> {
    return mongoCollection<PublicHolidaysDoc>(config.mongo.dbName, config.holidays.collections.publicHolidays);
  }
}
