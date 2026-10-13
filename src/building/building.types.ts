import type { Brand } from "../shared/brand.types";
import type { CAMPUSES } from "./building.constants";

export type SkkuId = Brand<number, "SkkuId">;

export type BuildNo = Brand<string, "BuildNo">;

export type DisplayNo = Brand<string, "DisplayNo">;

export type SpaceCd = Brand<string, "SpaceCd">;

export type Campus = (typeof CAMPUSES)[number];

export interface BilingualText {
  ko: string;
  en: string;
}

export type WithCampusLabel<T> = T & { campusLabel: string };

export type WithBuildNo<T extends { buildNo: BuildNo | null }> = T & { buildNo: BuildNo };
