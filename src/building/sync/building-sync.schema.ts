import { z } from "zod";
import { isBuildNo, isSkkuId, isSpaceCd } from "../building.rules";

// QUIRK(skku): campusMap.do misspells longtitude, spcaeNm and spcae_nm, kept as sent. Only what the
// mapping cannot do without is required (measured 2026-10-10).
const coordinate = z.string().refine((value) => Number.isFinite(parseFloat(value)));

export const skkuBuildListResponse = z.object({ buildItems: z.array(z.unknown()) });

export const skkuBuildListItem = z.object({
  id: z.number().refine(isSkkuId),
  buildNo: z.string().refine(isBuildNo).or(z.literal("")).nullish(),
  buildNm: z.string().min(1),
  buildNmEng: z.string().optional(),
  krText: z.string().optional(),
  enText: z.string().optional(),
  latitude: coordinate,
  longtitude: coordinate,
  filePath: z.string().optional(),
  encodeNm: z.string().optional(),
  handicappedElevatorYn: z.string().optional(),
  handicappedToiletYn: z.string().optional(),
  createDt: z.string().optional(),
  updateDt: z.string().optional(),
});

export const skkuBuildInfoResponse = z.object({
  attachItem: z.array(z.unknown()),
  floorItem: z.array(z.unknown()),
});

export const skkuBuildInfoAttachment = z.object({
  id: z.number().int(),
  file_path: z.string().optional(),
  encode_nm: z.string().optional(),
  file_nm: z.string().optional(),
  image_alt: z.string().optional(),
});

export const skkuBuildInfoFloor = z.object({
  space_cd: z.string().refine(isSpaceCd),
  floor_nm: z.string(),
  floor_nm_eng: z.string().optional(),
  spcae_nm: z.string().optional(),
  spcae_nm_eng: z.string().optional(),
});

export const skkuSpaceListResponse = z.object({ items: z.array(z.unknown()) });

export const skkuSpaceListItem = z.object({
  spaceCd: z.string().refine(isSpaceCd),
  buildNo: z.string().refine(isBuildNo),
  floorNm: z.string(),
  floorNmEng: z.string().optional(),
  spcaeNm: z.string().optional(),
  spcaeNmEng: z.string().optional(),
  buildNm: z.string().optional(),
  buildNmEng: z.string().optional(),
  conspaceCd: z.string().nullish(),
});

export type SkkuBuildListItem = z.output<typeof skkuBuildListItem>;
export type SkkuBuildInfoAttachment = z.output<typeof skkuBuildInfoAttachment>;
export type SkkuBuildInfoFloor = z.output<typeof skkuBuildInfoFloor>;
export type SkkuSpaceListItem = z.output<typeof skkuSpaceListItem>;
