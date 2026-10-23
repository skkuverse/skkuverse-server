import crypto from "crypto";
import type { IndexedStop } from "../stop-index/bus-stop-index.types";
import { JONGRO_POLE_CAMPUS } from "./bus-stop-list.constants";
import type { StopCampus } from "./bus-stop-list.types";
import type { BusStopList } from "./bus-stop-list.wire";

/** WHY: a catalog stop's own campus, else HSSC for a stop standing at a Jongno pole, else none until a push sets one. */
export function toStopCampus({ localStop, poles }: Pick<IndexedStop, "localStop" | "poles">): StopCampus | null {
  return localStop?.campus ?? (poles.length > 0 ? JONGRO_POLE_CAMPUS : null);
}

// WHY: the body derives from the stops' revision, each stations version and each path version, so its hash moves with them.
export function toStopListEtag(stopList: BusStopList): string {
  return `"stops-${crypto.createHash("md5").update(JSON.stringify(stopList)).digest("hex")}"`;
}
