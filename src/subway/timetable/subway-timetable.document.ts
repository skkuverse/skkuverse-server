import type { Timetable } from "./subway-timetable.types";

export interface TimetableManifestPart {
  key: string;
  partId: string;
}

// CONTRACT(scripts): written by scripts/lib/datasets/parts.js (npm run data), which validates every part at push;
// the header's data is the manifest, one part per table key, and the server still parses what it reads.
export interface SubwayTimetablesDatasetDoc {
  _id: string;
  revision: number;
  data: { parts: TimetableManifestPart[] };
  updatedAt: Date;
  updatedBy: string;
}

export type StoredTimetableManifest = Pick<SubwayTimetablesDatasetDoc, "revision" | "data">;

// CONTRACT(scripts): written once by scripts/lib/datasets/parts.js under `<dataset>/<key>@<sha256 prefix>` and never
// changed; its data is the table in canonical JSON, keys sorted.
export interface SubwayTimetablePartDoc {
  _id: string;
  dataset: string;
  key: string;
  sha256: string;
  data: Timetable;
  savedAt: Date;
  savedBy: string;
}
