import type { getBusGroups } from "./bus-config.data";

export type BusGroup = ReturnType<typeof getBusGroups>[number];
export type BusGroupVisibility = BusGroup["visibility"];
