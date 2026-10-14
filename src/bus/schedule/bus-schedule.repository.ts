import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import logger from "../../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import { parseEach } from "../../shared/zod-list.util";
import type { BusOverrideDoc, BusScheduleDoc } from "./bus-schedule.document";
import { busOverrideDoc, busScheduleDoc } from "./bus-schedule.schema";

const PATTERN_PROJECTION = { _id: 0, serviceId: 1, patternId: 1, days: 1, entries: 1, effectiveFrom: 1, effectiveUntil: 1 } as const;
const OVERRIDE_PROJECTION = { _id: 0, serviceId: 1, date: 1, type: 1, entries: 1, label: 1, notices: 1 } as const;

@Injectable()
export class BusScheduleRepository implements OnModuleInit {
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("bus.schedule", () => this.ensureIndexes());
  }

  async listPatterns(serviceId: string): Promise<BusScheduleDoc[]> {
    const docs = await this.schedules().find({ serviceId }, { projection: PATTERN_PROJECTION, maxTimeMS: HOT_READ_MAX_TIME_MS }).toArray();
    return this.keepValid("bus_schedules", parseEach(docs, busScheduleDoc, (doc, index) => this.keyOf(doc, index, ["serviceId", "patternId"])));
  }

  async listOverrides(serviceId: string, from: string, until: string): Promise<BusOverrideDoc[]> {
    const docs = await this.overrides()
      .find({ serviceId, date: { $gte: from, $lte: until } }, { projection: OVERRIDE_PROJECTION, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .toArray();
    return this.keepValid("bus_overrides", parseEach(docs, busOverrideDoc, (doc, index) => this.keyOf(doc, index, ["serviceId", "date"])));
  }

  private keyOf(doc: unknown, index: number, fields: readonly string[]): string {
    if (typeof doc !== "object" || doc === null) return `#${index}`;
    return fields.map((field) => String((doc as Record<string, unknown>)[field])).join("/");
  }

  private keepValid<T>(collection: string, { valid, invalid }: { valid: T[]; invalid: string[] }): T[] {
    if (invalid.length > 0) {
      logger.error({ event: "bus.schedule.invalid_document", collection, invalid }, "Timetable documents left out: not the shape the timetable scripts write");
    }
    return valid;
  }

  // WHY: the timetable scripts upsert by these keys; unique, so a typo cannot add a second document for one.
  private async ensureIndexes(): Promise<void> {
    await this.schedules().createIndex({ serviceId: 1, patternId: 1 }, { unique: true });
    await this.overrides().createIndex({ serviceId: 1, date: 1 }, { unique: true });
  }

  private schedules(): Collection<BusScheduleDoc> {
    return mongoCollection<BusScheduleDoc>(config.mongo.dbName, "bus_schedules");
  }

  private overrides(): Collection<BusOverrideDoc> {
    return mongoCollection<BusOverrideDoc>(config.mongo.dbName, "bus_overrides");
  }
}
