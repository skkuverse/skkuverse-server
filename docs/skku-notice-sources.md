---
title: Notice Crawl Sources (snapshot, retired)
type: reference
status: deprecated
owner: spencer0124
last-updated: 2026-11-06
audience: internal
---

# SKKU Notice Crawl Sources (snapshot)

> [!WARNING]
> **This document is retired.** It held a snapshot of the crawl sources, a stale copy of a list this repository vendors. The original text is kept in git history. Each owner below is the source of truth.

| To learn | Look at |
| --- | --- |
| The sources the server serves | [`../src/notices/sources.json`](../src/notices/sources.json), vendored from skkuverse-crawler and hash-locked in `.contracts.lock.json` |
| The crawler's per-department config (strategy, selectors, base URL) | `sources.json` at the root of `skkuverse-crawler`, outside this repository |
| Department coverage by campus and college | The coverage analysis in `skkuverse-crawler`, outside this repository |
| Which fields each strategy yields | The notices data contract in `skkuverse-crawler`, outside this repository |

The full docs index is [docs/README.md](README.md).
