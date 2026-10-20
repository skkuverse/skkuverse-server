/**
 * In-memory SubwayTimetableRepository: the content database's
 * `subway-timetables` header and its `dataset_parts`. The reads read as the
 * real ones do (pinned in src/subway/timetable/subway-timetable.repository.spec.ts):
 * the header's revision and each part's key and id, a part's data by its id,
 * each parsed with the same schema, so a missing or invalid document reads as
 * `null`. `storeTables` stores tables unchecked as the next revision, one part
 * per key with a content id as npm run data names it, so a test can seed an
 * invalid one, a gap, or the same content twice. `failWith` makes the next
 * reads reject as a database error would, wrapped in SubwayTimetablesReadError
 * as the real reads wrap it; `manifestReads` counts the header reads that
 * reached the store and `tableReads` the part ids read, in order.
 */
import { createHash } from "node:crypto";
import type { StoredTimetableManifest, TimetableManifestPart } from "../../../../src/subway/timetable/subway-timetable.document";
import { SubwayTimetablesReadError } from "../../../../src/subway/timetable/subway-timetable.error";
import type { SubwayTimetableRepository } from "../../../../src/subway/timetable/subway-timetable.repository";
import { storedTimetableManifest, timetableFile } from "../../../../src/subway/timetable/subway-timetable.schema";
import type { Timetable } from "../../../../src/subway/timetable/subway-timetable.types";
import type { PublicOf } from "../public-of";

type StoredTable = Pick<Timetable, "operator" | "line" | "dayType">;

export class FakeSubwayTimetableRepository implements PublicOf<SubwayTimetableRepository> {
  header: { revision: unknown; data: unknown } | null = null;
  parts = new Map<string, unknown>();
  failWith: Error | null = null;
  manifestReads = 0;
  tableReads: string[] = [];

  /** The part id npm run data gives `table`'s content under its key. */
  static partIdOf(table: StoredTable): string {
    const key = `${table.operator}-${table.line}-${table.dayType}`;
    return `subway-timetables/${key}@${createHash("sha256").update(JSON.stringify(table)).digest("hex").slice(0, 16)}`;
  }

  /** Stores `tables` unchecked as the next revision, one part per table, ordered by key; returns that revision. */
  storeTables(tables: readonly StoredTable[]): number {
    const revision = typeof this.header?.revision === "number" ? this.header.revision + 1 : 1;
    const entries = tables.map((table) => {
      const partId = FakeSubwayTimetableRepository.partIdOf(table);
      this.parts.set(partId, structuredClone(table));
      return { key: `${table.operator}-${table.line}-${table.dayType}`, partId };
    });
    this.header = { revision, data: { parts: entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) } };
    return revision;
  }

  async findManifest(): Promise<StoredTimetableManifest | null> {
    if (this.failWith) throw new SubwayTimetablesReadError(this.failWith);
    this.manifestReads += 1;
    if (this.header === null) return null;
    const parsed = storedTimetableManifest.safeParse(structuredClone(this.header));
    return parsed.success ? parsed.data : null;
  }

  async findTable({ partId }: TimetableManifestPart, _revision: number): Promise<Timetable | null> {
    if (this.failWith) throw new SubwayTimetablesReadError(this.failWith);
    this.tableReads.push(partId);
    if (!this.parts.has(partId)) return null;
    const parsed = timetableFile.safeParse(structuredClone(this.parts.get(partId)));
    return parsed.success ? parsed.data : null;
  }
}
