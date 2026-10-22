---
title: Notice List Ordering — an Immutable Key, not `crawledAt`
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-22
audience: internal
---

# 0007. Notice List Ordering — an Immutable Key, not `crawledAt`

> Why the notice list and its cursor order on `(date, _id)` and still carry an unread `c`. Decided 2026-09-13 ([skkuverse#52](https://github.com/spencer0124/skkuverse/issues/52)).

## Context

The list sorted on `{date: -1, crawledAt: -1, _id: -1}`. The crawler rewrites `crawledAt`: every 30 minutes it re-crawls page 0 of every source and touches each unchanged notice to refresh it. A sort key must be immutable, and `crawledAt` is a liveness stamp whose purpose is to move. `date` is a day-granular string, so ties within a day are the norm and the second key does the ordering.

Measured on prod 2026-09-06: one tick wrote 1,264 documents across 115 sources (93 writes/s at peak), and 39 `(sourceId, date)` groups, 247 documents, held both touched and untouched rows. Two notices sharing a `date` swapped places every 30 minutes, so a cursor paging across them could skip a row or serve it twice.

## Decision

**Order on `{date: -1, _id: -1}`.** `crawledAt` keeps its liveness meaning and loses its ordering role.

- `_id` was already the tiebreaker, and already the effective key for most rows: the crawler stamps one `now` over a whole flush, so touched rows tie on `crawledAt`.
- It is never rewritten, and its timestamp orders by insertion, which is what "newest first within a day" means. The crawler's health probe counts first-seen documents by ObjectId time for the same reason.
- The read index follows the sort (`FORCE_INDEX`, `src/notices/list/notices-list.query.ts`). A hinted index is dropped only after no deployed version hints it: a `hint()` on a missing index throws `BadValue` and 500s every list request.

**The cursor keeps its `{d, c, i}` shape.** `c` is never read, but `encodeCursor` still emits it and `decodeCursor` accepts a cursor without it. Cursors live in app memory across a deploy, so a cursor minted by one release must decode in the one before, or a rollback 400s everyone mid-scroll. A malformed `c` is still rejected: absent and corrupt are different things.

## Consequences

- The ordering flip is gone, independent of any crawler change, and the list order no longer depends on when the crawler last ran.
- Nothing sorts on `crawledAt`, so the crawler may stop rewriting it (most of the Atlas write volume of a tick changes nothing a reader sees). The dispatch gate had to move off it first: [ADR 0008](0008-dispatch-age-gate-on-publication-date.md).
- Within a day, an edited notice no longer jumps to the top. Judged correct: an old notice's edit reordering today's list was a side effect of the touch.
- **Open:** retiring `c` is a separate release, once no deployed server requires it.
