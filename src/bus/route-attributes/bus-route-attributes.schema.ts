import { z } from "zod";
import { isHex6 } from "../../infra/color";
import type { StoredRouteAttributes } from "./bus-route-attributes.document";
import type { JongroRouteAttributesData } from "./bus-route-attributes.types";

const NON_EMPTY = "required non-empty string";

const hex6 = z.string().refine(isHex6, "must be 6-char hex string");

const transferLine = z.strictObject({ line: z.string().min(1, NON_EMPTY), color: hex6 });

const routeAttributes = z.strictObject({
  themeColor: hex6,
  iconType: z.string().min(1, NON_EMPTY),
  refreshInterval: z.number().refine((seconds) => seconds > 0, "required positive number"),
  /** WHY: crowding compares a bus's passenger count with this; 18 is a 9 m village bus until the real count is known. */
  seatCount: z.number().refine((seats) => Number.isInteger(seats) && seats > 0, "required positive integer"),
  /** WHY: keyed by ARS number, so a stop's subway badges follow it when TOPIS moves it in the list. */
  transferLinesByArsId: z.record(z.string(), z.array(transferLine).min(1, "required non-empty array")).superRefine((linesByArsId, ctx) => {
    if (Object.hasOwn(linesByArsId, "")) ctx.addIssue({ code: "custom", path: [""], message: "ARS number must be a non-empty string" });
  }),
});

export const jongroRouteAttributesDataset = z.strictObject({
  routes: z.record(z.string(), routeAttributes),
}) satisfies z.ZodType<JongroRouteAttributesData>;

export const storedRouteAttributes = z.object({ revision: z.int().positive(), data: jongroRouteAttributesDataset }) satisfies z.ZodType<StoredRouteAttributes>;
