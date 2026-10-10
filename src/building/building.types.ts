import type { Brand } from "../shared/brand.types";
import type { CAMPUSES } from "./building.rules";

/** SKKU's building id: `_id` in buildings and buildings_raw, and the ends of a connection. */
export type SkkuId = Brand<number, "SkkuId">;

/** SKKU's building number ("227"). A facility has none. */
export type BuildNo = Brand<string, "BuildNo">;

/** The number shown to users, derived from a BuildNo by toDisplayNo. */
export type DisplayNo = Brand<string, "DisplayNo">;

/** A room code. */
export type SpaceCd = Brand<string, "SpaceCd">;

/** The building id exactly as buildList sent it; buildInfo takes it back verbatim. */
export type ApiId = Brand<string, "ApiId">;

/** hssc = 인사캠, nsc = 자과캠. SKKU's own code for each is SKKU_CAMPUS_CODE. */
export type Campus = (typeof CAMPUSES)[number];

/** A bilingual text; a missing side is "". */
export interface BilingualText {
  ko: string;
  en: string;
}

export type WithCampusLabel<T> = T & { campusLabel: string };
