import type { z } from "zod";
import type { busGroupVisibility, getBusGroups } from "./bus-config.data";

export type BusGroup = ReturnType<typeof getBusGroups>[number];
export type BusGroupVisibility = z.output<typeof busGroupVisibility>;
