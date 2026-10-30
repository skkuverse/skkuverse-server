---
title: Strict Config Validation + Pre-deploy Dry-load
type: adr
status: accepted
owner: spencer0124
last-updated: 2026-10-27
audience: internal
---

# 0004. Strict Config Validation + Pre-deploy Dry-load

> Why a missing config value crashes instead of falling back, and why every deploy loads the config in a throwaway container before it replaces anything. Decided 2026-04-10 (PR #44, #45).

## Context

A silent fallback in the config, such as a missing database name falling back to another database or a missing start date to a hard-coded one, hides the difference between laptop, CI and production: each passes, and weeks later data has piled up in the wrong database.

## Decision

- **Fail loud, not safe.** A value that redirects data or moves a boundary (a database name, a date filter) has no default: a missing one exits at boot and names the variable to set. A plain operational default (a port, a poll interval) may stay, since it redirects no data. The required list is `src/infra/required-env.ts`, scoped by role ([ADR 0012](0012-runtime-roles.md), D4).
- **Dry-load before the rolling update.** After the image builds and before any container is replaced, the deploy loads the config (`require('./dist/src/infra/config')`) in a throwaway container with the same image, the same rendered `.env` and `NODE_ENV=production`: no port, no Mongo connection, no poller. It runs once per role, because required values differ by role and an api-only check would pass with a poller key missing. Any failure aborts with nothing replaced.
- `.env` is rendered from the maintainers' secret store before the dry-load, and `__tests__/nest/config/env-manifest.test.ts` fails when the code and the key lists disagree.

The layers, each for its own failure: a missing value → the dry-load (seconds, before any change); a crash right after start or a transient DB failure during the update → the auto-rollback; silent drift → no fallback to drift into.

## Consequences

- A missing value fails the deploy in seconds instead of crash-looping after it. A crash for minutes beats days of data in the wrong place.
- Strict is inconvenient on purpose: adding a required variable touches the required list, both key lists, the secret store and `jest.setup.ts` (CLAUDE.md, Environment).
- Not covered: a database connection lost at runtime (monitoring's job), bad production data, and a bug in the dry-load step itself, which was watched on its first deploy.
