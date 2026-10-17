import { z } from "zod";

const KST_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
// QUIRK(seoul-subway-api): the Shinbundang line numbers its trainsets from 1, in one or two digits (2026-10-17 probe).
const TRAIN_NO = /^\d{1,4}$/;
const SUBWAY_ID = /^\d{4}$/;

// QUIRK(seoul-subway-api): a failure answers HTTP 200 with this body bare, a success with it under
// `errorMessage` beside the rows (both captured 2026-10-16).
export const seoulApiStatus = z.object({ status: z.number().int(), code: z.string().min(1) });

export const seoulPositionRow = z.object({
  trainNo: z.string().regex(TRAIN_NO),
  statnNm: z.string().min(1),
  statnTnm: z.string().min(1),
  updnLine: z.enum(["0", "1"]),
  trainSttus: z.enum(["0", "1", "2", "3"]),
  recptnDt: z.string().regex(KST_DATE_TIME),
});

export const seoulArrivalRow = z.object({
  subwayId: z.string().regex(SUBWAY_ID),
  btrainNo: z.string().regex(TRAIN_NO),
  statnNm: z.string().min(1),
  barvlDt: z.string().regex(/^\d+$/),
  recptnDt: z.string().regex(KST_DATE_TIME),
});

export const seoulPositionBody = z.object({ errorMessage: seoulApiStatus, realtimePositionList: z.array(seoulPositionRow) });

export const seoulArrivalBody = z.object({ errorMessage: seoulApiStatus, realtimeArrivalList: z.array(seoulArrivalRow) });

export type SeoulPositionRow = z.infer<typeof seoulPositionRow>;

export type SeoulArrivalRow = z.infer<typeof seoulArrivalRow>;
