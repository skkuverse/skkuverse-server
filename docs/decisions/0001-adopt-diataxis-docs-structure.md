---
title: Adopt Diátaxis Docs Structure
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-22
audience: internal
---

# 0001. Adopt a Diátaxis Docs Structure

> Why `docs/` is split by the reader's need, carries frontmatter and never copies values from code. The rules themselves live in [docs/README.md](../README.md). Decided 2026-07-22.

## Context

- `docs/` had grown flat with no rules, while `skkuverse-app` already had a rules file, a frontmatter schema and a markdownlint gate.
- After the 2026-05-31 Express → NestJS port, every doc but `README.md` still described the deleted Express tree. The root cause was copied values: file paths and counts written into prose go stale silently when the code moves.
- Two mega-docs mixed reference, explanation, decisions, runbooks and postmortems, so a settled contract could not be told from an incident note by its path.

## Decision

- Folders follow [Diátaxis](https://diataxis.fr/), split by the reader's need, not by topic: `how-to/`, `reference/`, `explanation/`, plus `decisions/`, `internal/`, `plans/` and `archive/`.
- Every doc has frontmatter, one H1 and a one-line summary, and points at the code instead of copying a path, version or count from it.
- markdownlint gates `docs/`. Docs not yet migrated are listed in the lint `ignores`; that list is the migration backlog.
- A legacy doc that is broken up becomes a `superseded` pointer stub, never deleted, so its inbound links keep working.

Rejected: keeping one flat folder with a prose precedence rule. It was the setup that drifted.

## Consequences

- A doc's purpose is visible from its path, and `last-updated` shows its age.
- Legacy flat docs keep a drift banner until they are broken up.
- This decision is about the docs layout only; the code layout is [ADR 0010](0010-server-architecture.md).
