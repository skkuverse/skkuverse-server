---
title: The Dispatch Gate Is the Crawler's factsAt, not aiSummaryAt
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-28
audience: internal
---

# 0024. The Dispatch Gate Is the Crawler's factsAt, not aiSummaryAt

> Why a notice becomes claimable for push once the crawler's live facts job writes `factsAt`, why the claim ignores `factsGate`, why the partial index took a new name, and what to check before and after the switch. Decided 2026-10-28 (notice facts on the server, unit S5).

## Context

- A notice was claimable once its ai summary landed: the claim filter and the partial index `dispatch_pending_idx` read `aiSummaryAt: { $type: "date" }`.
- The crawler's `facts` record replaces the ai summary (skkuverse-crawler `docs/notice-facts/design.md`, "Facts replaces summary: consumers and cutover"). Once ai_summary stops for new notices (its cutover step 5), nothing writes `aiSummaryAt`, and a gate on it pushes nothing.
- The push gate contract (same file, "Push gate contract (crawler ↔ server)"): only the live job `notices-facts`, every 10 minutes, writes `factsAt` and `factsGate`, once per copy, and only on copies whose group was first seen within the last 6 hours. It writes them when the facts are stored (`ok`), at the third failure (`failed`), or 30 minutes after `firstSeenAt` with no facts (`timeout`). A backfill or a re-extraction never writes them.
- ai_summary skips a notice with no text (an image-only poster) and one that failed three times, so such a notice never got `aiSummaryAt` and was never pushed. The live job gates it like any other.
- MongoDB cannot change an index's partial filter in place: a `createIndex` that reuses a name with another filter fails, and `ensureIndexesAtBoot` (`src/infra/mongo.ts`) only logs the failure.

## Decision

- **The claim filter reads `factsAt: { $type: "date" }` in place of `aiSummaryAt`.** Every other guard stays: `pushedAt: null`, the 14-day KST date floor ([ADR 0008](0008-dispatch-age-gate-on-publication-date.md)), the attempt cap, `isDeleted`, and the lease ([ADR 0003](0003-fcm-dispatch-cloud-function-claim-lease.md)). The filter is `toClaimFilter` in `src/notices/dispatch/notices-dispatch.query.ts`.
- **`factsGate` does not gate the claim.** All three values are claimable, because the crawler writes the gate to say "push now". The claim no longer waits for a summary, so the push body (`src/notices/dispatch/notices-dispatch.client.ts`) must not depend on one: a notice with facts gets a body derived from them, and a `failed` or `timeout` notice is title-only. That client change ships no later than this one.
- **A new partial index, `dispatch_pending_facts_idx`**, partial on the claim's own `{ pushedAt: null, factsAt: { $type: "date" } }` and keyed on the claim's sort `(date, _id)`, so the claim reads it in order with no sort stage (`DISPATCH_PENDING_INDEX` in the same file). The poller creates it at boot.
- **No code drops `dispatch_pending_idx`.** The poller stops creating it, and a maintainer drops it by hand once the release that stopped reading it is healthy. A rollback after the drop stays correct: its claims run unindexed until its poller boots and creates the old index again.
- **The index ships ahead of the claim that reads it** ([ADR 0012](0012-runtime-roles.md), D3). It is its own commit, so it can go out one deploy early. Before the claim switches, `getIndexes()` on `notices` must list `dispatch_pending_facts_idx`. If both ship in one deploy, each claim an api replica runs between its own restart and the poller's index build scans the collection.

Rejected:

- Keeping `aiSummaryAt` as an alternative gate (`$or`). A notice would push on whichever landed first, so whether its body came from the summary or from facts would be a race. One partial index could not serve both branches, and the gate would keep a field the crawler is about to stop writing.
- Claiming only `factsGate: "ok"`. A notice whose extraction failed or timed out would never push. The crawler's 30-minute timeout exists so that a slow or broken extraction still delivers a title-only push.
- Reusing the name `dispatch_pending_idx` with the new filter. Index creation fails on prod, and the boot only warns.

## Consequences

- **The switch releases a backlog.** Notices the live job gated but ai_summary skipped have waited since the job started, and the first sweep after the switch claims them, newest first. On 2026-10-28 prod held 12 in the 14-day window, all image-only, one gated a day before (`pushedAt: null`, not deleted, `factsAt` a date, `aiSummaryAt` not a date). Count them before the release, and stamp the epoch `pushedAt` on any that should not push late.
- **Some notices are never pushed.** A notice is lost when it was first seen before the live job ran, when it has no `firstSeenAt`, or when the live job was down or skipping ticks for longer than 6 hours after it was first seen. Nothing on the server reports such a notice. Before the release, count the notices the old gate would push and the new one never will (`pushedAt: null`, not deleted, in the window, `aiSummaryAt` a date, `factsAt` not a date): 0 on prod on 2026-10-28.
- **A claim still waits for a sweep.** The crawler pings `POST /internal/notices/dispatch-pending` only at the end of an ai_summary batch (hourly), and the poller's cron sweeps every 30 minutes by default. The live job sends no ping, so a gated notice waits for one of the two. When ai_summary stops, its ping stops with it, so the live job must ping after the ticks that write a gate before then.
- **The suppression procedure keeps its form and gets less time.** Stamping `pushedAt` with the epoch still keeps a backlog from pushing (skkuverse-crawler `docs/known-issues.md` §13). It must land before the live job's next tick, at most 10 minutes after the crawl, and before the 30-minute timeout gates whatever extraction has not reached.
- **Cross-posted copies are gated one by one.** A copy first seen after the tick that gated its sibling is gated a tick later, and a sweep between the two pushes them separately, as a late sibling does today ([ADR 0005](0005-notice-dispatch-content-group.md)).
- **A rollback after ai_summary stops pushes nothing.** The previous image claims on `aiSummaryAt`, which new notices no longer get. Before then, rolling back pushes no notice twice, because a notice pushed under `factsAt` carries `pushedAt`. It does push every unpushed notice in the window that has `aiSummaryAt`, those the live job missed included.
- The server reads `aiSummaryAt` nowhere.
