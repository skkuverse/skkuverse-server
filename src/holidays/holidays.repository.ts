import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { mongoCollection } from "../infra/mongo";
import type { PublicHolidaysDoc } from "./holidays.document";
import type { PublicHoliday } from "./holidays.types";

// WHY: keyed by the year, so a rerun of the sync replaces that year instead of adding a document.
@Injectable()
export class HolidaysRepository {
  listYears(): Promise<PublicHolidaysDoc[]> {
    return this.publicHolidays()
      .find({}, { projection: { _id: 1, holidays: 1, fetchedAt: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .toArray();
  }

  async upsertYear(year: number, holidays: readonly PublicHoliday[], fetchedAt: Date): Promise<void> {
    await this.publicHolidays().updateOne({ _id: year }, { $set: { holidays: [...holidays], fetchedAt } }, { upsert: true });
  }

  private publicHolidays(): Collection<PublicHolidaysDoc> {
    return mongoCollection<PublicHolidaysDoc>(config.mongo.dbName, "public_holidays");
  }
}
