import type { Document, Filter } from "mongodb";
import { escapeRegex } from "../../shared/regex.util";
import type { BuildingDoc, SpaceDoc } from "../building.document";
import { CAMPUSES, isCampus } from "../building.rules";
import type { Campus } from "../building.types";
import {
  BUILDING_SEARCH_LIMIT,
  BUILDING_STRONG_MIN_SCORE,
  BUILDING_TIERS,
  BUILDING_WEAK_LIMIT,
  NO_TIER_SCORE,
  SPACE_SEARCH_LIMIT,
  SPACE_STRONG_MIN_SCORE,
  SPACE_TIERS,
  SPACE_WEAK_LIMIT,
  tierRegex,
} from "./building-search.rules";
import type { RankedFacet, RankedSearchResult, RelevanceTier } from "./building-search.types";

// $regexMatch throws on a non-string, and two production rows have spaceCd: null.
// `$type`, not `$ifNull`, so a numeric spaceCd from SKKU cannot fail every
// search either (ADR 0006, Consequences).
function pathMatches(path: string, regex: string): Document {
  const field = `$${path}`;
  return {
    $regexMatch: {
      input: { $cond: [{ $eq: [{ $type: field }, "string"] }, field, ""] },
      regex,
      options: "i",
    },
  };
}

/** Case-insensitive rather than uppercased: one production spaceCd is lowercase (712115b). */
function tiersToScoreExpr(
  tiers: readonly RelevanceTier[],
  keyword: string,
): Document {
  const escaped = escapeRegex(keyword);
  const branches = tiers.map((tier) => {
    const regex = tierRegex(tier.mode, escaped);
    const cases = tier.paths.map((path) => pathMatches(path, regex));
    const first = cases[0];
    if (!first) {
      throw new Error("[building] relevance tier declares no paths");
    }
    return {
      case: cases.length === 1 ? first : { $or: cases },
      then: tier.score,
    };
  });
  return { $switch: { branches, default: NO_TIER_SCORE } };
}

/** Campus-free on purpose: the counts share it, and the app's campus toggle shows both campuses. */
function spaceKeywordFilter(keyword: string): Filter<SpaceDoc> {
  const keywordPattern = { $regex: escapeRegex(keyword), $options: "i" };
  return {
    $or: [
      { spaceCd: keywordPattern },
      { "name.ko": keywordPattern },
      { "name.en": keywordPattern },
      { "buildingName.ko": keywordPattern },
      { "buildingName.en": keywordPattern },
    ],
  };
}

/** No buildNo, for the reason given on BUILDING_TIERS. */
function buildingKeywordFilter(keyword: string): Filter<BuildingDoc> {
  const escaped = escapeRegex(keyword);
  const keywordPattern = { $regex: escaped, $options: "i" };
  return {
    $or: [
      { "name.ko": keywordPattern },
      { "name.en": keywordPattern },
      { "description.ko": keywordPattern },
      // A prefix, so "2" lists 20, 21 … 27.
      { displayNo: { $regex: `^${escaped}`, $options: "i" } },
    ],
  };
}

function toRankedResult<T>(facets: readonly RankedFacet<T>[]): RankedSearchResult<T> {
  const facet = facets[0];
  if (!facet) {
    throw new Error("[building] search $facet returned no document");
  }
  const campusCounts: Record<Campus, number> = { hssc: 0, nsc: 0 };
  // $group gives a document without `campus` the _id null: it counts for neither campus.
  for (const row of facet.counts) {
    if (isCampus(row._id)) campusCounts[row._id] = row.n;
  }
  const campusTotal = CAMPUSES.reduce((sum, campus) => sum + campusCounts[campus], 0);
  const ranked = [...facet.strong, ...facet.weak];
  // Not a silent fallback: $count emits no document when the match set is empty.
  const total = facet.total[0]?.n ?? 0;
  return {
    items: ranked,
    counts: { ...campusCounts, total: campusTotal },
    total,
    truncated: total > ranked.length,
  };
}

interface RankedSearchSpec {
  keywordFilter: (keyword: string) => Document;
  tiers: readonly RelevanceTier[];
  strongMinScore: number;
  strongLimit: number;
  weakLimit: number;
  projection: Readonly<Record<string, 0>>;
  /** Must make the sort a total order, so the response is stable across syncs. */
  tiebreak: Readonly<Record<string, 1>>;
}

/** spaceCd breaks ties: the sync's weekly delete and re-upsert reorders the documents on disk. */
const SPACE_SEARCH: RankedSearchSpec = {
  keywordFilter: spaceKeywordFilter,
  tiers: SPACE_TIERS,
  strongMinScore: SPACE_STRONG_MIN_SCORE,
  strongLimit: SPACE_SEARCH_LIMIT,
  weakLimit: SPACE_WEAK_LIMIT,
  projection: { _id: 0, _score: 0, sources: 0, syncedAt: 0 },
  tiebreak: { spaceCd: 1 },
};

/** _id breaks ties: SKKU's integer id, which the sync upserts by and never deletes. */
const BUILDING_SEARCH: RankedSearchSpec = {
  keywordFilter: buildingKeywordFilter,
  tiers: BUILDING_TIERS,
  strongMinScore: BUILDING_STRONG_MIN_SCORE,
  strongLimit: BUILDING_SEARCH_LIMIT,
  weakLimit: BUILDING_WEAK_LIMIT,
  projection: { _score: 0, extensions: 0, sync: 0, enrichVersion: 0 },
  tiebreak: { _id: 1 },
};

/** One $facet returns the rows and the counts, so the counts cannot describe another predicate. */
function rankedSearchPipeline(search: RankedSearchSpec, keyword: string, campus?: Campus | null): Document[] {
  const campusStage: Document[] = campus ? [{ $match: { campus } }] : [];
  const projectStage = { $project: { ...search.projection } };
  const sortStage = { $sort: { _score: -1, ...search.tiebreak } };

  return [
    { $match: search.keywordFilter(keyword) },
    { $addFields: { _score: tiersToScoreExpr(search.tiers, keyword) } },
    {
      $facet: {
        strong: [
          ...campusStage,
          { $match: { _score: { $gte: search.strongMinScore } } },
          sortStage,
          { $limit: search.strongLimit },
          projectStage,
        ],
        weak: [
          ...campusStage,
          { $match: { _score: { $lt: search.strongMinScore } } },
          sortStage,
          { $limit: search.weakLimit },
          projectStage,
        ],
        counts: [{ $group: { _id: "$campus", n: { $sum: 1 } } }],
        total: [...campusStage, { $count: "n" }],
      },
    },
  ];
}

export {
  BUILDING_SEARCH,
  SPACE_SEARCH,
  buildingKeywordFilter,
  rankedSearchPipeline,
  spaceKeywordFilter,
  tiersToScoreExpr,
  toRankedResult,
};
