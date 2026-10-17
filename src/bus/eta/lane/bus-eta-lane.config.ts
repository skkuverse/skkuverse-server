import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../../infra/config-file";
import { deepFreeze } from "../../bus.rules";
import { corridorIssues, strategyIssues } from "./bus-eta-lane.rules";
import { laneConfigFile } from "./bus-eta-lane.schema";
import type { LaneConfig, SequenceKey } from "./bus-eta-lane.types";

// WHY: scripts/build-bus-lane-corridor.js writes the corridor and probe ranges; scripts/copy-build-assets.js stages it.
// EVIDENCE: entry and exit points checked 2026-10-17 with NAVER traoptimal between the campus shuttle stops: the route
// keeps to the expressway between them with no U-turn, each point within 4 m of the path (that script, --check-entry-exit).
const LANE_CONFIG_FILE = path.join(__dirname, "bus-lane.json");

export function loadLaneConfig(raw: unknown, sequences: readonly SequenceKey[]): Readonly<LaneConfig> {
  const schema = laneConfigFile.superRefine((config, ctx) => {
    for (const { path: at, message } of [...corridorIssues(config), ...strategyIssues(config.strategies, sequences)]) {
      ctx.addIssue({ code: "custom", path: at, message });
    }
  });
  return deepFreeze(parseConfigFile("bus-lane.json", schema, raw));
}

export function readLaneConfig(sequences: readonly SequenceKey[]): Readonly<LaneConfig> {
  return loadLaneConfig(JSON.parse(fs.readFileSync(LANE_CONFIG_FILE, "utf8")), sequences);
}
