---
title: Notices — the Server Reads, the Crawler and the AI Write
type: adr
status: accepted
owner: spencer0124
last-updated: 2026-10-22
audience: internal
---

# 0002. Notices — the Server Reads, the Crawler and the AI Write

> Who owns which part of the `notices` collection, which three repositories share. Decided 2026-04-10.

## Context

- The crawler already creates the collection's unique index. A second `createIndex` of it with other options from the server fails with `IndexOptionsConflict`, and a dropped and re-created index would hurt the crawler's writes.
- With no owner for sanitizing crawled HTML, it is done twice or not at all.
- A body can reach 5 MB, and the crawler and the summarizer add fields at any time, so a server tied to the whole document shape breaks on their changes.

## Decision

- **skkuverse-crawler** owns the documents, their content fields and the unique index. The canonical field and index definitions are the crawler's `docs/reference/schema/notices.md`; server docs never copy them.
- **skkuverse-ai** owns the `summary*` fields, written with `$set`.
- **The server** writes no content field. It owns its read index (`FORCE_INDEX` in `src/notices/list/notices-list.query.ts`, [ADR 0007](0007-notice-ordering-key.md)), the dispatch partial index (`DISPATCH_PENDING_INDEX` in `src/notices/dispatch/notices-dispatch.query.ts`), and the push bookkeeping fields only `NoticesDispatchRepository` writes ([ADR 0003](0003-fcm-dispatch-cloud-function-claim-lease.md)).
- **Sanitizing is the crawler's.** It stores sanitized GFM as `cleanMarkdown`, and the server only passes it through as `contentMarkdown`. HTML and plain-text bodies are never served, so the server has no XSS surface of its own; the app's Markdown renderer sanitizes what it renders.

## Consequences

- Index ownership cannot collide: each repository manages only its own indexes.
- The server's reads have no side effect on content, so its deploys and rollbacks are safe for the data.
- **An implicit cross-repo contract.** A crawler change to the `cleanMarkdown` conversion or a field name can break responses silently; check it against [reference/notices-api.md](../reference/notices-api.md). Body-conversion defects (a misaligned GFM table) are fixed in the crawler only.
- Projection and body-field choices: [explanation/notices-architecture.md](../explanation/notices-architecture.md).
