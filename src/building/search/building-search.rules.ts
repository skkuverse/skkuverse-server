// SEE: docs/decisions/0006-building-search-relevance-ranking.md: why the tiers, bands and caps
// are what they are, with the production measurements.
import { escapeRegex } from "../../shared/regex.util";
import type { StringPath } from "../../shared/string-path.types";
import type { BuildingDoc, SpaceDoc } from "../building.document";
import type { RelevanceTier, TierMode } from "./building-search.types";

// EVIDENCE: a building-number query returns whole buildings (the largest has 801 rooms);
// a weak substring hit is capped hard because the app mounts every row.
const SPACE_SEARCH_LIMIT = 1000;
const SPACE_WEAK_LIMIT = 100;

// EVIDENCE: 78 buildings exist, so only the weak cap binds. It trims description-only hits
// (`q=관`: 29 of 69), which the results list gives no visible reason for.
const BUILDING_SEARCH_LIMIT = 100;
const BUILDING_WEAK_LIMIT = 10;

/** WHY: passed the keyword filter but matched no tier: reachable only if the filter and the tiers drift. */
const NO_TIER_SCORE = 0;

const SPACE_TIERS: readonly RelevanceTier<SpaceDoc>[] = [
  { score: 60, paths: ["spaceCd"], mode: "exact" },
  { score: 50, paths: ["spaceCd"], mode: "prefix" },
  { score: 40, paths: ["buildingName.ko", "buildingName.en"], mode: "prefix" },
  { score: 30, paths: ["name.ko", "name.en"], mode: "prefix" },
  { score: 20, paths: ["spaceCd"], mode: "substring" },
  {
    score: 10,
    paths: ["buildingName.ko", "buildingName.en"],
    mode: "substring",
  },
  { score: 5, paths: ["name.ko", "name.en"], mode: "substring" },
];

// WHY: no buildNo: its leading digit is the campus code, so a buildNo prefix on "27"
// would rank 270, 271 and 272 for building 27.
const BUILDING_TIERS: readonly RelevanceTier<BuildingDoc>[] = [
  { score: 50, paths: ["displayNo"], mode: "exact" },
  { score: 40, paths: ["displayNo"], mode: "prefix" },
  { score: 30, paths: ["name.ko", "name.en"], mode: "prefix" },
  { score: 20, paths: ["name.ko", "name.en"], mode: "substring" },
  { score: 10, paths: ["description.ko"], mode: "substring" },
];

function scoreOfTier<TDoc>(tiers: readonly RelevanceTier<TDoc>[], mode: TierMode, path: StringPath<TDoc>): number {
  const tier = tiers.find((t) => t.mode === mode && t.paths.includes(path));
  if (!tier) throw new Error(`[building] no ${mode} relevance tier on ${path}`);
  return tier.score;
}

const SPACE_STRONG_MIN_SCORE = scoreOfTier(SPACE_TIERS, "prefix", "spaceCd");

const BUILDING_STRONG_MIN_SCORE = scoreOfTier(BUILDING_TIERS, "substring", "name.ko");

// QUIRK(mongo): Mongo matches with PCRE2 and scoreLocally with the JS engine. They agree on an
// escaped literal with optional anchors, so keep every pattern to that.
function tierRegex(mode: TierMode, escaped: string): string {
  switch (mode) {
    case "exact":
      return `^${escaped}$`;
    case "prefix":
      return `^${escaped}`;
    case "substring":
      return escaped;
  }
}

/** WHY: a non-string reads as "", the same `$type` rule pathMatches applies in Mongo. */
function readPath(doc: Record<string, unknown>, path: string): string {
  let current: unknown = doc;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : "";
}

/** WHY: the JS reading of a tier table, so specs pin the ranking without Mongo. */
function scoreLocally<TDoc>(
  tiers: readonly RelevanceTier<TDoc>[],
  keyword: string,
  doc: Record<string, unknown>,
): number {
  const escaped = escapeRegex(keyword);
  for (const tier of tiers) {
    const tierPattern = new RegExp(tierRegex(tier.mode, escaped), "i");
    if (tier.paths.some((path) => tierPattern.test(readPath(doc, path)))) return tier.score;
  }
  return NO_TIER_SCORE;
}

export {
  BUILDING_SEARCH_LIMIT,
  BUILDING_STRONG_MIN_SCORE,
  BUILDING_TIERS,
  BUILDING_WEAK_LIMIT,
  NO_TIER_SCORE,
  SPACE_SEARCH_LIMIT,
  SPACE_STRONG_MIN_SCORE,
  SPACE_TIERS,
  SPACE_WEAK_LIMIT,
  scoreLocally,
  tierRegex,
};
