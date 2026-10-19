/**
 * In-memory BusScheduleContentRepository: the content database's `datasets`,
 * one document per dataset name. Each read reads as the real read does
 * (pinned in src/bus/schedule-content/bus-schedule-content.repository.spec.ts):
 * the dataset's revision and data only, parsed with the same schema, so a
 * missing or invalid document reads as `null`. `storeServiceNotices` and
 * `storeRestDays` store data unchecked at the next revision, as `npm run data` would without its
 * checks, so a test can seed an invalid one. `failWith` makes the next reads
 * reject, as a database error would, wrapped in BusScheduleContentReadError as
 * the real read wraps it; `readCount` counts the `bus-service-notices` reads
 * that reached the store and `restDaysReadCount` the `skku-rest-days` ones.
 */
import { BUS_SERVICE_NOTICES_DATASET, SKKU_REST_DAYS_DATASET } from "../../../../src/bus/schedule-content/bus-schedule-content.constants";
import { BusScheduleContentReadError } from "../../../../src/bus/schedule-content/bus-schedule-content.error";
import type { BusScheduleContentRepository } from "../../../../src/bus/schedule-content/bus-schedule-content.repository";
import { storedRestDays, storedServiceNotices } from "../../../../src/bus/schedule-content/bus-schedule-content.schema";
import type { RestDaysRevision, ServiceNoticesRevision } from "../../../../src/bus/schedule-content/bus-schedule-content.types";
import type { PublicOf } from "../public-of";

export class FakeBusScheduleContentRepository implements PublicOf<BusScheduleContentRepository> {
  datasets = new Map<string, { revision: unknown; data: unknown }>();
  failWith: Error | null = null;
  readCount = 0;
  restDaysReadCount = 0;

  /** Stores `data` as the next revision of `bus-service-notices`, unchecked, and returns that revision. */
  storeServiceNotices(data: unknown): number {
    return this.store(BUS_SERVICE_NOTICES_DATASET, data);
  }

  async findServiceNotices(): Promise<ServiceNoticesRevision | null> {
    const doc = this.read(BUS_SERVICE_NOTICES_DATASET);
    if (doc === undefined) return null;
    const parsed = storedServiceNotices.safeParse(structuredClone(doc));
    return parsed.success ? { revision: parsed.data.revision, services: parsed.data.data.services } : null;
  }

  /** Stores `data` as the next revision of `skku-rest-days`, unchecked, and returns that revision. */
  storeRestDays(data: unknown): number {
    return this.store(SKKU_REST_DAYS_DATASET, data);
  }

  async findRestDays(): Promise<RestDaysRevision | null> {
    const doc = this.read(SKKU_REST_DAYS_DATASET);
    if (doc === undefined) return null;
    const parsed = storedRestDays.safeParse(structuredClone(doc));
    return parsed.success ? { revision: parsed.data.revision, restDays: parsed.data.data } : null;
  }

  private store(dataset: string, data: unknown): number {
    const current = this.datasets.get(dataset);
    const revision = typeof current?.revision === "number" ? current.revision + 1 : 1;
    this.datasets.set(dataset, { revision, data: structuredClone(data) });
    return revision;
  }

  private read(dataset: string): { revision: unknown; data: unknown } | undefined {
    if (this.failWith) throw new BusScheduleContentReadError(dataset, this.failWith);
    if (dataset === SKKU_REST_DAYS_DATASET) this.restDaysReadCount += 1;
    else this.readCount += 1;
    return this.datasets.get(dataset);
  }
}
