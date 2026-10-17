import { z } from "zod";

// QUIRK(data-go-kr): getRestDeInfo answers `items` as "" when a year has no rows, and `item` as an object
// instead of an array when it has one (both captured 2026-10-16).
export const restDeEnvelope = z.object({
  response: z.object({
    header: z.object({ resultCode: z.string(), resultMsg: z.string().optional() }),
    body: z.unknown().optional(),
  }),
});

export const restDeRow = z.object({
  dateName: z.string().min(1),
  isHoliday: z.enum(["Y", "N"]),
  locdate: z.number().int().min(10000101).max(99991231),
});

export const restDeBody = z.object({
  items: z.union([z.literal(""), z.object({ item: z.union([restDeRow, z.array(restDeRow)]) })]),
  totalCount: z.number().int().nonnegative(),
});

// QUIRK(data-go-kr): the gateway in front of every API answers a request it refuses (a key, a header) with
// this envelope instead of `response`, with HTTP 400, 403 or 200; `returnReasonCode` names the refusal.
export const gatewayError = z.object({
  OpenAPI_ServiceResponse: z.object({
    cmmMsgHeader: z.object({ errMsg: z.string().min(1), returnReasonCode: z.string().optional(), returnAuthMsg: z.string().optional() }),
  }),
});
