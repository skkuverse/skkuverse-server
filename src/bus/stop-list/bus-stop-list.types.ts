import type { BusStopList } from "./bus-stop-list.wire";

export type ListedStop = BusStopList["stops"][number];
export type ListedRoute = ListedStop["routes"][number];
export type LocalizedText = ListedStop["name"];
export type StopCampus = NonNullable<ListedStop["campus"]>;
