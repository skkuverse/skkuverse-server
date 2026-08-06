---
title: Building Search — Relevance Ranking over a Declarative Tier Table
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-22
audience: internal
---

# 0006. Building Search — Relevance Ranking over a Declarative Tier Table

> Why `GET /building/search` ranks by SKKU's own room numbering, why the row caps are split into two bands, and the limits of a ranked scan. Decided 2026-08-06 ([issue #91](https://github.com/spencer0124/skkuverse-server/issues/91)).

## Context

The search matched `spaceCd` by equality, so `27` never found room `27101`, and it had no sort: which 20 of 209 matches a user saw was physical order, which the weekly sync reshuffled by deleting and re-inserting `spaces`. Counts were a second hand-written copy of the predicate, and counted rows the list did not return.

## Decision

### The ranking signal comes from SKKU's numbering, not a heuristic

The user-facing building number is `displayNo` (`toDisplayNo`: `buildNo` without its campus digit, `227` on nsc → `27`), and SKKU numbers every room in a building as `displayNo` + floor + room (`27101`, `27422`; on hssc, 62 → `627xx`). So "`spaceCd` starts with the query" is literally "rooms in building N", and that is the top tier after an exact match. The tiers and their scores are `building-search.rules.ts`.

### Tiers are declarative data, compiled two ways

The tier table compiles to a Mongo `$switch` (`building-search.query.ts`) and to a JS predicate for specs (`scoreLocally`), both from one `tierRegex()`. They share the pattern, not the engine: MongoDB matches with PCRE2, the JS twin with V8. That is safe only because a tier emits an escaped literal with optional anchors, where the two agree; re-check before adding a free-form pattern.

The sort is a total order (`_score`, then `spaceCd` for rooms and `_id` for buildings), so results are stable across syncs. `_id` is safe for buildings because it is SKKU's integer id and the sync never deletes a building; it would not be for `spaces`, whose ObjectIds the delete-and-reinsert regenerates.

### Buildings match `displayNo`, never `buildNo`

`buildNo`'s first digit is the campus prefix (1 hssc, 2 nsc), so `buildNo: /^27/` would surface `270` 대강당, `271` 의학관 and `272` 체육관 to someone who meant building 27.

### Rows and counts come from one `$facet`

One pipeline returns rows and counts, so they cannot disagree. **Counts stay campus-agnostic on purpose**: they feed the app's campus toggle badge, which shows both campuses whatever the `campus` param. So `campus` applies inside the rows facet only. Rejected: hoisting `{campus}` into the top `$match` for an `IXSCAN campus_1`; it silently breaks the badge.

### Row caps are split into two bands

Measured on prod: the largest building (기숙사신관 `298`) has 801 rooms, `q=29` matches 895, `q=연구` 1765, `q=실` 6173; a row averages ~247 B. Keeping every building whole needs ~1000 rows, but a flat 1000 would ship 1000 rows for `q=연구`, and the app had no minimum query length.

- **Strong** (`_score >= SPACE_STRONG_MIN_SCORE`, the query is a prefix of the room's code): returned up to 1000, above the 801-room maximum.
- **Weak** (the query only appears inside): capped at 100. Buildings cut the same way below the name-substring tier, so description-only matches (a field the list never shows) cap at 10.

Strong then weak keeps relevance order for free, since every strong score is above every weak one. `meta.limits` reports the cut, so a capped list never poses as the whole result.

Rejected: no cap at all. `q=실` would ship ~1.5 MB and 6,173 rows to a phone.

**The bands do not bound a one-digit numeric query, and cannot**: `^2` matches 1,839 rooms, all strong, and `q=2` is what fires while someone types "27101". The server cannot tell that from someone who means building 2, so the client must virtualize its result list. The two are complementary: the bands drop pointless rows, virtualization drops the cost of legitimate ones. **Open (skkuverse-app):** its `SearchScreen` still mounts every row in a `ScrollView` with an eager `.map()` on `dev` (2026-10-22); the virtualized list sits unmerged on its branch `feat/search-virtualized-list`.

Under the cap and without `campus`, `meta.spaceCount` equals `meta.counts.space.total`, so the section header and the campus tab agree. With `campus` they differ by design.

## Consequences

**A ranked search scans.** You cannot rank a set you have not enumerated, and no index removes the scan: a `$or` uses index union only if every branch is indexed, `name.*` and `buildingName.*` are not, and `$options: "i"` defeats prefix anchoring anyway. Measured: ~1,242 docs examined (~4 ms) became ~7,691 (~20 ms) per scan, still a net win over the six scans before. `spaces` is ~2.5 MB. If it grows about tenfold, Atlas Search with an `autocomplete`/`edgeGram` mapping on `spaceCd` is what removes the scan.

**`$regexMatch` throws on a non-string input** (`$regexMatch needs 'input' to be of type string`, verified on the cluster), and two production rows have `spaceCd: null`. Every scored path is coerced with a `$type` test, not `$ifNull`: `$ifNull` would still pass a number, and the sync passes SKKU's JSON values through, so one numeric `spaceCd` would make every search 500, for every query. The JS twin uses the same `typeof === "string"` rule.

Exactly one room code has a lowercase letter (`712115b`), so matching is case-insensitive rather than uppercase-normalized.

**The `$facet` ceiling**: each facet is capped at 100 MB in memory with no spill to disk, and the result document at 16 MB. 1000 rows × ~247 B is far from it, but it breaks first if `spaces` grows.
