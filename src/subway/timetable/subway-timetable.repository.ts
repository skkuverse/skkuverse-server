import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { SUBWAY_TIMETABLES_DATASET, TIMETABLES_LOG_INTERVAL_MS } from "./subway-timetable.constants";
import type { StoredTimetableManifest, SubwayTimetablePartDoc, SubwayTimetablesDatasetDoc, TimetableManifestPart } from "./subway-timetable.document";
import { SubwayTimetablesReadError } from "./subway-timetable.error";
import { storedTimetableManifest, storedTimetablePart } from "./subway-timetable.schema";
import type { Timetable } from "./subway-timetable.types";

@Injectable()
export class SubwayTimetableRepository {
  private readonly logThrottle = createLogThrottle(TIMETABLES_LOG_INTERVAL_MS);

  async findManifest(): Promise<StoredTimetableManifest | null> {
    const doc = await this.datasets()
      .findOne(
        { _id: SUBWAY_TIMETABLES_DATASET },
        { projection: { revision: 1, "data.parts.key": 1, "data.parts.partId": 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
      )
      .catch((err: unknown) => {
        throw new SubwayTimetablesReadError(err);
      });
    if (doc === null) return this.report({ event: "subway.timetables.missing", subject: "header" }, "Subway timetables dataset not found");
    const parsed = storedTimetableManifest.safeParse(doc);
    if (parsed.success) return parsed.data;
    const invalid = { event: "subway.timetables.invalid", subject: String(doc.revision), revision: doc.revision, issues: this.toIssueLines(parsed.error) };
    return this.report(invalid, "Subway timetables header fails its schema, not served");
  }

  async findTable({ key, partId }: TimetableManifestPart, revision: number): Promise<Timetable | null> {
    const doc = await this.parts()
      .findOne({ _id: partId }, { projection: { data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new SubwayTimetablesReadError(err);
      });
    const fields = { subject: partId, revision, key, partId };
    if (doc === null) return this.report({ event: "subway.timetables.part_missing", ...fields }, "A subway timetable the manifest names is not stored");
    const parsed = storedTimetablePart.safeParse(doc);
    if (parsed.success) return parsed.data.data;
    return this.report({ event: "subway.timetables.part_invalid", ...fields, issues: this.toIssueLines(parsed.error) }, "A stored subway timetable fails its schema");
  }

  // WHY: throttled per event and subject (the header's revision, a part's id), so a new revision or part logs at once.
  private report({ event, subject, ...fields }: { event: string; subject: string } & Record<string, unknown>, message: string): null {
    const taken = this.logThrottle.take(`${event} ${subject}`);
    if (taken) logger.error({ event, dataset: SUBWAY_TIMETABLES_DATASET, ...fields, ...taken }, message);
    return null;
  }

  private toIssueLines(error: z.ZodError): string[] {
    return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }

  private datasets(): Collection<SubwayTimetablesDatasetDoc> {
    return mongoCollection<SubwayTimetablesDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }

  private parts(): Collection<SubwayTimetablePartDoc> {
    return mongoCollection<SubwayTimetablePartDoc>(config.content.dbName, config.content.collections.datasetParts);
  }
}
