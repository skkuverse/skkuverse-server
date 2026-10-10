/**
 * Building / room search relevance: a declarative tier table, the row caps per
 * relevance band, and scoreLocally, the JS reading of the table that the specs
 * pin ranking intent with. building-search.query.ts compiles the same table
 * into Mongo, through the same tierRegex.
 *
 * The ranking is ADR 0006 (docs/decisions/0006-building-search-relevance-ranking.md):
 * a room is found by any prefix of its own code, and the order is total, so it
 * survives the weekly sync.
 *
 * THE RANKING SIGNAL
 * ------------------
 * SKKU codes every room as displayNo + floor + room: building 27 (buildNo 227,
 * displayNo "27") owns 27101, 27422, ... So "spaceCd starts with the query" is
 * literally "rooms in building N" — the top-tier signal is the university's own
 * numbering scheme, not an invented heuristic. toDisplayNo() in ../building.rules.ts
 * performs the same buildNo -> displayNo mapping for the response.
 */
import { escapeRegex } from "../../shared/regex.util";
import type { RelevanceTier, TierMode } from "./building-search.types";

// Row caps come in two bands, because a single flat cap cannot serve both
// goals at once. The product promise is
// "type 27, get building 27's rooms" — the largest building (기숙사신관, buildNo
// 298) has 801 rooms, so a cap that never truncates a building must be ~1000.
// But the same cap applied to a weak keyword hit is a liability: "연구" matches
// 1764 rooms, "실" matches 6173, and the app renders results in a plain
// ScrollView with an eager .map() (SearchScreen.tsx) — no virtualization — so
// every returned row is mounted at once, ~8 React elements each. A 1000-row
// response to a one-character query is a multi-second freeze on mid-range
// Android, and the app has no minimum query length.
//
// So the cap is split by relevance band. STRONG = the query is a prefix of the
// room's own code, i.e. genuinely "rooms in building N"; those are returned in
// full. WEAK = everything the query merely appears inside; those are the long
// tail nobody scrolls, capped tightly.
//
//   q=27   -> 168 strong + <=100 weak
//   q=298  -> 801 strong + <=100 weak
//   q=연구  ->   0 strong + <=100 weak
//   q=실    ->   0 strong + <=100 weak
//
// meta.limits.truncated still reports any cut, so a truncated tail is never
// presented as the whole result.
//
// Consequence worth knowing: for a query under the cap AND no campus filter,
// meta.spaceCount === meta.counts.space.total, so the app's section header and
// campus-tab badge agree. With ?campus= set they legitimately differ —
// spaceCount is campus-scoped while counts stays campus-agnostic (it feeds the
// toggle). The app is unaffected because it reads the badge from a separate
// campus-less request.
const SPACE_SEARCH_LIMIT = 1000;
const SPACE_WEAK_LIMIT = 100;
/** Cuts at the spaceCd-prefix tier (50) — see SPACE_TIERS. */
const SPACE_STRONG_MIN_SCORE = 50;

// buildings holds 78 documents total, so the strong cap is above the maximum
// possible match count. The weak band matters for a different reason: `q=관`
// matches 69 buildings, 29 of them ONLY through description.ko — a field the
// results list never renders, so those rows have no visible reason to be there.
const BUILDING_SEARCH_LIMIT = 100;
const BUILDING_WEAK_LIMIT = 10;
/** Cuts below the name-substring tier (20), leaving description-only (10) weak. */
const BUILDING_STRONG_MIN_SCORE = 20;

/**
 * Room relevance, highest first.
 *
 * The ordering that matters: spaceCd PREFIX (50) outranks spaceCd SUBSTRING
 * (20) and name matches (5). Query "27" therefore yields 27101, 27102, 27104,
 * ... before 남자숙실(1227) — whose spaceCd 91227 merely contains "27" — and
 * before 숙실(271), which matches on name alone.
 */
const SPACE_TIERS: readonly RelevanceTier[] = [
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

/**
 * Building relevance, highest first.
 *
 * buildNo is deliberately absent. Its leading digit is an internal campus
 * prefix (1 = hssc, 2 = nsc), so a buildNo prefix on "27" would surface 270
 * 대강당, 271 의학관 and 272 체육관 to a user who meant building 27. displayNo
 * is the user-facing number (buildNo "227" -> displayNo "27").
 */
const BUILDING_TIERS: readonly RelevanceTier[] = [
  { score: 50, paths: ["displayNo"], mode: "exact" },
  { score: 40, paths: ["displayNo"], mode: "prefix" },
  { score: 30, paths: ["name.ko", "name.en"], mode: "prefix" },
  { score: 20, paths: ["name.ko", "name.en"], mode: "substring" },
  { score: 10, paths: ["description.ko"], mode: "substring" },
];

/**
 * The single source of the mode -> regex-source mapping. Both compilers below
 * call it, so a tier cannot mean one thing in Mongo and another in JS.
 *
 * Note this guarantees the PATTERN is shared, not that execution is identical:
 * MongoDB matches with PCRE2 while scoreLocally uses the JS engine. The tier
 * table only ever produces an escaped literal with optional anchors, where the
 * two agree — do not add free-form patterns here without re-checking that.
 */
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

/** Reads a dotted path, coercing anything non-string to "" (mirrors $ifNull). */
function readPath(doc: Record<string, unknown>, path: string): string {
  let current: unknown = doc;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : "";
}

/**
 * JS twin of tiersToScoreExpr (building-search.query.ts) — the executable specification of the tier table.
 * Tests assert ranking intent through this, so ordering is pinned without a
 * live MongoDB. Both compilers derive their pattern from tierRegex().
 */
function scoreLocally(
  tiers: readonly RelevanceTier[],
  query: string,
  doc: Record<string, unknown>,
): number {
  const escaped = escapeRegex(query);
  for (const tier of tiers) {
    const tierPattern = new RegExp(tierRegex(tier.mode, escaped), "i");
    if (tier.paths.some((path) => tierPattern.test(readPath(doc, path)))) return tier.score;
  }
  return 0;
}

export {
  BUILDING_SEARCH_LIMIT,
  BUILDING_STRONG_MIN_SCORE,
  BUILDING_TIERS,
  BUILDING_WEAK_LIMIT,
  SPACE_SEARCH_LIMIT,
  SPACE_STRONG_MIN_SCORE,
  SPACE_TIERS,
  SPACE_WEAK_LIMIT,
  scoreLocally,
  tierRegex,
};
