---
title: Mini-App Push Link Policy
type: adr
status: accepted
owner: spencer0124
last-updated: 2026-10-26
audience: internal
---

# 0020. Mini-App Push Link Policy

> Where a mini-app push may send the person who taps it, who may send one, and what a repeated send does. Read it before you change what the push route (`POST /miniapps/:id/notifications`, signed) accepts, its credentials or its retries. Accepted 2026-10-22; the 400 texts are in [miniapps-api.md](../reference/miniapps-api.md) ("5.2 `POST /miniapps/:id/notifications` (signed)").

## Status

Accepted 2026-10-22.

## Context

- A push `route` reaches the app's router as written. Some app routes open something else: `/webview?url=` opens any URL, `/mini-app?id=` opens any registered mini app, `/games/<id>` opens a game. A push that wrapped one of them would open a page under the sender's name and badge.
- The app already keeps a list of the screens a link from outside the app may open (`ALLOWED_PATHS` in `skkuverse-app/apps/mobile/src/bootstrap/deep-links/deep-links.rules.ts`).
- Some pushes stored before this decision open another mini app through `/mini-app?id=`, because `miniapp` then refused another mini app.
- The Cloud Function call times out after 30 s and the Function keeps sending, so a send answered `unknown` may still reach every device, and a retried send pushes twice.

## Decision

### D1. A push route is an exact allowlist

A push `route` is one of the app's outside-link screens or exactly `/miniapp-feed/<sender id>`, with no query string and nothing after it (a list `PUSH_CONTENT_POLICY` holds, [ADR 0023](0023-perimeter-ports.md)). Anything else is refused with a 400 that lists the allowed routes, before anything is written or sent. Rejected: a denylist of opener routes, because it reopens silently each time the app adds one (`/games` was added after the denylist was first proposed).

### D2. URLs and mini apps go through their typed actions

A web page is a `webview` or `external` action, whose value must be an https URL, and a mini app is a `miniapp` action. A `miniapp` push target names a mini app in the registry the send was authorized against, the sender or another, hidden from the home grid or not, and never a game or an unregistered id.

### D3. Stored history is not rewritten

Rows stored before D1 keep the action they were sent with, and the public feed serves them as stored. The app's feed rule is where such a row is checked.

### D4. A send credential of its own

Superseded by D6: each mini app signs its own calls, and no send credential is shared with another caller.

### D5. A repeated send is answered from the stored row

A send may carry an `Idempotency-Key`. The key is stored on the row it writes, and a unique partial index on `{ miniAppId, idempotencyKey }` lets only one send claim it, so a repeat with the key answers the first row's outcome and never calls the Cloud Function again, whatever that outcome was; a row with no outcome yet answers `unknown`. A repeat whose notification differs from the stored one is refused (422): answering the first one's outcome would report a send that never happened. The poller builds the index (ADR 0012, D3). The send reads the key before it claims, so a sequential repeat is answered even where the index does not exist yet, and only a concurrent one needs it. Rejected: a server-side retry, because only the Cloud Function log can tell an `unknown` that reached devices from one that did not.

### D6. Each mini app signs its own calls

Amended 2026-10-26. A mini app's backend sends on `POST /miniapps/:id/notifications` and reads its history on `GET /miniapps/:id/notifications/history`, signing each call with an Ed25519 key whose public half its registry entry's `sender` lists, beside its `status` and `scopes` ([miniapps-api.md](../reference/miniapps-api.md), "5.4 Signed calls"). The signature covers the `Idempotency-Key`, which a signed send must carry, so a captured send cannot be replayed under a new key, and a replay under its own key answers the stored outcome (D5). The server stores only public keys; `suspended` stops a sender within the registry cache TTL, without a deploy. Each send counts against configured per-app and global quotas. `MINIAPP_PUSH_AUTHORIZER` verifies ([ADR 0023](0023-perimeter-ports.md)) and takes no shared token. Rejected: a per-app HMAC secret, which the server would have to store and protect; it stays the fallback if a sender cannot sign Ed25519.

There is no shared send token and no internal push route: `/internal/miniapps/*` answers 404. Every send carries an `Idempotency-Key`; rows stored before that rule carry none, so `SentNotificationDoc.idempotencyKey` stays optional.

## Consequences

- An operator who needs a screen the list does not name asks for it to be added to the app's outside-link list first, then to `PUSH_CONTENT_POLICY`'s route list.
- A `/mini-app?id=` route is refused; a cross-mini-app open is a `miniapp` target (D2).
- A sender holds its own private signing key, never a token the server also holds.
- An operator who fixes a refused (`not_sent`) send resends it with a new key: the old key keeps answering `not_sent`.
