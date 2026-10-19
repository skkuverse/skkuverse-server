import type { StoredLaneCorridor } from "./bus-eta-lane.document";
import { toLegBounds } from "./bus-eta-lane.rules";
import type { LaneCorridorSnapshot } from "./bus-eta-lane.types";

export function toCorridorSnapshot({ revision, data }: StoredLaneCorridor): LaneCorridorSnapshot {
  const { corridor, entryExit, probeRoutes } = data;
  return {
    revision,
    corridor,
    probeRoutes,
    corridorEndsOf: (direction) => entryExit[direction],
    legBoundsOf: (direction) => toLegBounds(corridor, entryExit[direction]),
  };
}
