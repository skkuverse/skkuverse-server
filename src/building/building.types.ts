import type { Brand } from "../shared/brand.types";
import type { CAMPUSES } from "./building.rules";

export type SkkuId = Brand<number, "SkkuId">;

export type BuildNo = Brand<string, "BuildNo">;

export type DisplayNo = Brand<string, "DisplayNo">;

export type SpaceCd = Brand<string, "SpaceCd">;

/** The building id exactly as buildList sent it: buildInfo takes it back verbatim. */
export type ApiId = Brand<number, "ApiId">;

export type Campus = (typeof CAMPUSES)[number];

/** A side SKKU left out is "", never absent. */
export interface BilingualText {
  ko: string;
  en: string;
}

export type WithCampusLabel<T> = T & { campusLabel: string };

export type WithBuildNo<T extends { buildNo: BuildNo | null }> = T & { buildNo: BuildNo };
