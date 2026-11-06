---
title: Notice Search Overview — Hybrid Retrieval, Per-Replica State
type: adr
status: accepted
owner: spencer0124
last-updated: 2026-11-06
audience: internal
---

# 0016. Notice Search Overview — Hybrid Retrieval, Per-Replica State

> Why `GET /notices/overview` retrieves with one `$rankFusion` over both Atlas search indexes, keeps its cache and budget pause in each replica's memory, limits its rate through `RATE_LIMIT_POLICY`, and spends its time budget as it does. Read it before you change the overview's retrieval, cache, limits or timeouts. Accepted 2026-10-07; what it serves is in [notices-api.md](../reference/notices-api.md), and skkuverse-ai owns the request and answer shapes (`skkuverse-ai/docs/notice-overview-api.md`).

## Context

- The list search ranks `$regex` hits by date; an overview must answer from the most relevant notices.
- `skku_notices.notices` has two Atlas search indexes: `notices_search` (lexical, `lucene.nori`, the whole corpus) and `notices_vector` (autoEmbed over `embeddingInput`, which only notices dated 2026-09-01 or later have). The cluster runs MongoDB 8.0: `$rankFusion` exists, `$scoreFusion` (8.2) does not.
- The api replicas share no cache (no Redis).

## Decision

### D1. Hybrid retrieval, in a request of its own

The overview is its own route, so the list never waits on the LLM. It ranks with one `$rankFusion` over both indexes, with the list's scope inside each sub-pipeline. The vector stage names no embedding model: the crawler owns that choice (skkuverse-crawler ADR-007).

Rejected: a `?overview=1` flag on the list (couples list latency to the LLM, and cursor pages would need regeneration rules); the regex list search (date-ranked, so it answers from the newest keyword hits); vector only (coverage starts at 2026-09-01); `$scoreFusion` (not on 8.0).

### D2. Cache and budget pause live in each replica

The overview cache and the pause after a `budget_exhausted` are per replica. Accepted: up to one ai call per replica for each distinct search; skkuverse-ai's token budget bounds the spend. Rejected: a Mongo-backed cache (database reads on the hot path) and Redis (new infrastructure).

Amended 2026-10-26: the overview rate limit, per replica until then, is the `notices-overview` class of `RATE_LIMIT_POLICY` ([ADR 0023](0023-perimeter-ports.md)). How production counts it is outside this repository.

Retrieval runs on every request, cache hits included, because the cache key holds the candidates' content hashes, so each request runs one `$rankFusion` with query-time embedding, bounded by the rate limit.

### D3. A 24-second budget

Retrieval gets `RETRIEVAL_MAX_TIME_MS` (query-time embedding included) and the ai call `AI_TIMEOUT_MS`, two budgets that sum to under 24 s. The app waits about 25 s with no retry. The budgets bound each step, not the response: `maxTimeMS` limits only MongoDB's own processing, so connection and network time come on top, and a slow retrieval followed by a full ai call can outlast the app's wait. A timeout outside this repository also bounds the request.

## Consequences

- The overview and the list may cite different notices: the list stays date-ranked, and moving it onto hybrid search would break its date cursor.
- `$vectorSearch` always returns its limit, so weakly related notices reach the ai, whose `no_answer` absorbs them. A similarity threshold waits for the `notices.overview.served` and `no_answer` rates.
