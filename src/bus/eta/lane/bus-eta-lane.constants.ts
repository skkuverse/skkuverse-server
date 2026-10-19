import type { LaneHours, LaneStrategies } from "./bus-eta-lane.types";

// WHY: the lane hours and strategies decide which estimate model a run gets, so they are code, not corridor data
// (ADR 0013 D2); HH:mm in KST, `from` inclusive and `to` exclusive.
export const LANE_HOURS: LaneHours = { from: "07:00", to: "21:00" };

// WHY: serviceId → routeType → strategy; an estimated sequence left out is `car`.
export const LANE_STRATEGIES: LaneStrategies = {
  "campus-inja": {
    regular: { strategy: "busLane", direction: "southbound" },
    hakbu: { strategy: "busLane", direction: "southbound" },
  },
  "campus-jain": {
    regular: { strategy: "busLane", direction: "northbound" },
    hakbu: { strategy: "busLane", direction: "northbound" },
  },
};
