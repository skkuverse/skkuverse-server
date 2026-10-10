/**
 * The Mongo form of the building search (ADR 0006): the tier table of
 * building-search.rules.ts compiled into a $switch score, the keyword
 * filters, the two ranked $facet pipelines and the decoding of their one
 * result document. BuildingSearchRepository runs them.
 */
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
  SPACE_SEARCH_LIMIT,
  SPACE_STRONG_MIN_SCORE,
  SPACE_TIERS,
  SPACE_WEAK_LIMIT,
  tierRegex,
} from "./building-search.rules";
import type { RankedSearchResult, RelevanceTier } from "./building-search.types";

/**
 * $regexMatch THROWS on non-string input, so every scored path is coerced first.
 * This is load-bearing, not defensive padding: two production `spaces` rows
 * already carry spaceCd: null (600주년기념관 buildNo 101, 의학관 buildNo 271 —
 * both spaceList-only records with empty names).
 *
 * The guard tests $type rather than using $ifNull, because $ifNull only covers
 * null and missing. The sync client (sync/building-sync.client.ts) passes SKKU's JSON values straight through
 * (`spaceCd: item.spaceCd`) and SkkuSpaceListItem.spaceCd: string is a
 * compile-time assertion about an EXTERNAL payload, not a runtime guarantee. If
 * SKKU ever emitted `"spaceCd": 27101` as a number, one such row would make
 * $regexMatch throw and every /building/search request would 500 — for every
 * query, not just ones touching that row. A non-string must not match rather
 * than throw, or one bad row becomes a total endpoint outage.
 *
 * Matching the `typeof cur === "string" ? cur : ""` in readPath also keeps the
 * JS twin and this compiler from disagreeing on non-string scalars.
 */
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

/**
 * Compiles a tier table into a $switch yielding the winning tier's score.
 *
 * Matching is case-insensitive rather than uppercase-normalised: spaceCd is
 * mostly digits with uppercase suffixes (27114A, 70B101) but exactly one row is
 * lowercase (712115b, 의학관 의학교육연구실), and "i" is what the keyword
 * filter already uses — one convention across both stages.
 */
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
    // Single-path tiers skip the $or wrapper — smaller, more readable pipeline.
    return {
      case: cases.length === 1 ? first : { $or: cases },
      then: tier.score,
    };
  });
  // default 0 means "passed the keyword filter but matched no tier", reachable
  // only if filter and table drift apart. It sorts last rather than blending
  // into a real tier.
  return { $switch: { branches, default: 0 } };
}

/**
 * Keyword predicate for rooms.
 *
 * Campus-free BY DESIGN: `counts` must stay campus-agnostic because it feeds
 * the app's campus toggle badge, so campus is applied inside the rows facet
 * only. Sharing this one builder between rows and counts is what makes the
 * badge structurally unable to contradict the list.
 *
 * spaceCd is a SUBSTRING match, not equality — prefix-beats-substring is
 * expressed in SPACE_TIERS, keeping the filter a simple superset. Any query
 * reaches spaceCd: escapeRegex neutralises metacharacters.
 */
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

/** Keyword predicate for buildings. See BUILDING_TIERS on why not buildNo. */
function buildingKeywordFilter(keyword: string): Filter<BuildingDoc> {
  const escaped = escapeRegex(keyword);
  const keywordPattern = { $regex: escaped, $options: "i" };
  return {
    $or: [
      { "name.ko": keywordPattern },
      { "name.en": keywordPattern },
      { "description.ko": keywordPattern },
      // Prefix, so "2" lists 20/21/.../27. A non-numeric query simply matches
      // no displayNo.
      { displayNo: { $regex: `^${escaped}`, $options: "i" } },
    ],
  };
}

interface RankedFacet<T> {
  strong: T[];
  weak: T[];
  counts: Array<{ _id: Campus | null; n: number }>;
  total: Array<{ n: number }>;
}

/** Decodes the one document a search pipeline's $facet emits. */
function toRankedResult<T>(facets: readonly Document[]): RankedSearchResult<T> {
  const facet = facets[0] as RankedFacet<T> | undefined;
  // $facet emits exactly one document by construction. An empty array means the
  // pipeline shape changed — a programming error, not a runtime condition.
  if (!facet) {
    throw new Error("[building] search $facet returned no document");
  }
  const campusCounts: Record<Campus, number> = { hssc: 0, nsc: 0 };
  // $group on $campus emits _id: null for a doc missing the field; such a row
  // belongs to neither campus and is excluded from the badge.
  for (const row of facet.counts) {
    if (isCampus(row._id)) campusCounts[row._id] = row.n;
  }
  const campusTotal = CAMPUSES.reduce((sum, campus) => sum + campusCounts[campus], 0);
  // Concatenation preserves relevance order: every strong score is by
  // definition above every weak one, and each band is already sorted.
  const ranked = [...facet.strong, ...facet.weak];
  // Not a silent fallback: $count legitimately emits zero documents when the
  // campus-scoped match set is empty.
  const total = facet.total[0]?.n ?? 0;
  return {
    items: ranked,
    counts: { ...campusCounts, total: campusTotal },
    total,
    truncated: total > ranked.length,
  };
}

/**
 * The ranked room search pipeline.
 *
 * One $facet returns the rows and the counts together, so they cannot
 * disagree. _score is computed once before the facet; the counts never read it.
 *
 * The { _score: -1, spaceCd: 1 } sort is a TOTAL order. The spaceCd tiebreak is
 * what makes "27" emit 27101, 27102, 27104, ... and what makes the response
 * stable across the 7-day building-sync (phase 3's deleteMany + re-upsert
 * rewrites physical document order).
 */
function spaceSearchPipeline(keyword: string, campus?: Campus | null): Document[] {
  const campusStage: Document[] = campus ? [{ $match: { campus } }] : [];
  const projectStage = {
    $project: { _id: 0, _score: 0, sources: 0, syncedAt: 0 },
  };
  const sortStage = { $sort: { _score: -1, spaceCd: 1 } };

  return [
    { $match: spaceKeywordFilter(keyword) },
    // Scored once here rather than inside each band: both bands read _score, so
    // hoisting it costs one pass instead of two.
    { $addFields: { _score: tiersToScoreExpr(SPACE_TIERS, keyword) } },
    {
      $facet: {
        strong: [
          ...campusStage,
          { $match: { _score: { $gte: SPACE_STRONG_MIN_SCORE } } },
          sortStage,
          { $limit: SPACE_SEARCH_LIMIT },
          projectStage,
        ],
        weak: [
          ...campusStage,
          { $match: { _score: { $lt: SPACE_STRONG_MIN_SCORE } } },
          sortStage,
          { $limit: SPACE_WEAK_LIMIT },
          projectStage,
        ],
        counts: [{ $group: { _id: "$campus", n: { $sum: 1 } } }],
        total: [...campusStage, { $count: "n" }],
      },
    },
  ];
}

/**
 * The ranked building search pipeline. Same shape as the room pipeline; the
 * tiebreak is _id, the SKKU-assigned integer id — building-sync upserts by
 * { _id: skkuId } and never deletes from this collection, so it is stable
 * across syncs (unlike an ObjectId, which a delete/reinsert cycle would
 * regenerate).
 */
function buildingSearchPipeline(keyword: string, campus?: Campus | null): Document[] {
  const campusStage: Document[] = campus ? [{ $match: { campus } }] : [];
  const projectStage = {
    $project: { _score: 0, extensions: 0, sync: 0, enrichVersion: 0 },
  };
  const sortStage = { $sort: { _score: -1, _id: 1 } };

  return [
    { $match: buildingKeywordFilter(keyword) },
    { $addFields: { _score: tiersToScoreExpr(BUILDING_TIERS, keyword) } },
    {
      $facet: {
        strong: [
          ...campusStage,
          { $match: { _score: { $gte: BUILDING_STRONG_MIN_SCORE } } },
          sortStage,
          { $limit: BUILDING_SEARCH_LIMIT },
          projectStage,
        ],
        weak: [
          ...campusStage,
          { $match: { _score: { $lt: BUILDING_STRONG_MIN_SCORE } } },
          sortStage,
          { $limit: BUILDING_WEAK_LIMIT },
          projectStage,
        ],
        counts: [{ $group: { _id: "$campus", n: { $sum: 1 } } }],
        total: [...campusStage, { $count: "n" }],
      },
    },
  ];
}

export {
  buildingKeywordFilter,
  buildingSearchPipeline,
  spaceKeywordFilter,
  spaceSearchPipeline,
  tiersToScoreExpr,
  toRankedResult,
};
