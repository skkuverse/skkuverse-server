---
title: Strict Config Validation + Pre-deploy Dry-load
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-27
audience: internal
---

# 0004. Strict Config Validation + Pre-deploy Dry-load

> Why a missing config value crashes instead of falling back, and why every deploy loads the config in a throwaway container before it replaces anything. Decided 2026-04-10 (PR #44, #45).

## Context

On 2026-04-10 the first notices deploy (PR #43) crash-looped in production and rolled back. The cause was a silent fallback in the config: a missing ad DB name fell back to the bus DB, and a missing service start date fell back to a hard-coded date. Such a fallback hides the difference between laptop, CI and production: each passes, and weeks later data has piled up in the wrong database. The incident record is kept with the operations records, outside this repository.

## Decision

- **Fail loud, not safe.** A value that redirects data or moves a boundary (a database name, a date filter) has no default: a missing one exits at boot and names the variable to set. A plain operational default (a port, a poll interval) may stay, since it redirects no data. The required list is `src/infra/required-env.ts`, scoped by role ([ADR 0012](0012-runtime-roles.md), D4).
- **Dry-load before the rolling update.** After the image builds and before any container is replaced, the host deploy script (run outside this repository; formerly `.github/workflows/deploy-host.yml`) loads the config in a throwaway container (`docker compose run --rm --no-deps -T … node -e "require('./dist/src/infra/config')"`), with the same image, the same rendered `.env` and `NODE_ENV=production`: no port, no Mongo connection, no poller. It runs once per role the host runs (as `api-1`, and on the active host as `poller`), because required values differ by role and an api-only check would pass with a poller key missing. Any failure aborts with nothing replaced, and a test of the deploy script pins it.
- `.env` is rendered from Doppler before the dry-load, and `__tests__/nest/config/env-manifest.test.ts` fails when the code and the key lists disagree.

The layers, each for its own failure: a missing value → the dry-load (seconds, before any change); a crash right after start or a transient DB failure during the update → the auto-rollback (PR #42); silent drift → no fallback to drift into.

## Consequences

- A missing value fails the deploy in seconds instead of crash-looping after it. A crash for minutes beats days of data in the wrong place.
- Strict is inconvenient on purpose: adding a required variable touches the required list, both key lists, both Doppler configs and `jest.setup.ts` (CLAUDE.md, Environment).
- Not covered: a database connection lost at runtime (monitoring's job), bad production data, and a bug in the dry-load step itself, which was watched on its first deploy.
