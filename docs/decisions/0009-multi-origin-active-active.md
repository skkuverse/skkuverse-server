---
title: Multiple Origins, Active-Active
type: adr
status: deprecated
owner: spencer0124
last-updated: 2026-11-06
audience: internal
---

# 0009. Multiple Origins, Active-Active

> Withdrawn: a multi-origin setup was tried and removed. Production topology is kept outside this repository; a future scale-out starts from a new decision. What remains is the one constraint other decisions rely on.

## Status

Deprecated. Its every-role seeding is superseded by [ADR 0012](0012-runtime-roles.md), D3.

## What still holds

- **One poller until leader election.** Every api replica reads the shared `bus_cache`, so one poller serves them all, and [ADR 0012](0012-runtime-roles.md) assumes exactly one. A second poller, on any host, needs leader election first, such as a lease document in MongoDB that expires by the database clock.
