---
title: Mini-App Registry API Reference
type: reference
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-26
audience: internal
---

# Mini-App Registry API

> The contract for `GET /miniapps` and `GET /miniapps/:id` — the registry the mobile client's home
> grid and mini-app shell both read — plus the manifest fetch that lets a first-party mini app change
> its own shell without a server deploy, and the broadcast feed endpoints beside them. The shared
> wire protocol a mini-app page and the app bridge speak is
> [skkuverse-miniapp's protocol reference](https://github.com/spencer0124/skkuverse-miniapp/blob/main/docs/reference/protocol.md);
> the server half of registering a mini app is
> [how-to/register-a-miniapp.md](../how-to/register-a-miniapp.md).

## 1. Summary

| | |
| --- | --- |
| Routes | `GET /miniapps`, `GET /miniapps/:id`, `GET /miniapps/:id/notifications`, the signed `POST /miniapps/:id/notifications` and `GET /miniapps/:id/notifications/history` (§5.2 to §5.4) |
| Auth | none on the three registry and feed routes; an Ed25519 signature by a key the mini app registered on the signed send and history (§5.4) |
| Rate limit | `GeneralRateLimitMiddleware`, applied to `miniapps` in `MiniappsModule.configure`; a send also takes the sender's quota (§5.2) |
| Wire types | `src/miniapps/miniapps.wire.ts` (index entry, detail, `ShellConfig`), `src/miniapps/catalog/miniapps-catalog.wire.ts` (index), `src/miniapps/notifications/miniapps-notifications.wire.ts` (feed, send outcome, history), `src/infra/fcm.wire.ts` (push payload) |
| Registry data | The `miniapps` dataset in the content database, `{ index, details }`, written only by `npm run data` ([how-to/register-a-miniapp.md](../how-to/register-a-miniapp.md)) and read by `src/miniapps/miniapps.repository.ts` |
| Schema check | `checkedRegistry` in `src/miniapps/miniapps.schema.ts` and `toRegistryIssues` in `src/miniapps/miniapps.rules.ts`, run at every push (§4); the read parses again with `storedRegistry` |
| Manifest fetch | `src/miniapps/manifest/miniapps-manifest.client.ts` (the poller's); the detail route reads what it stored through `MiniappsManifestService.shellFieldsFor` |
| Service | `src/miniapps/miniapps.service.ts`: `current()`, the registry snapshot of the revision read, the door every route and other module reads it through |
| Controllers | `src/miniapps/catalog/miniapps-catalog.controller.ts`, `src/miniapps/notifications/miniapps-notifications.controller.ts` |
| Broadcast feed | `src/miniapps/notifications/miniapps-notifications.service.ts`, `src/miniapps/notifications/miniapps-notifications.repository.ts` (Mongo) |
| Target grammar | `parseMiniAppTarget` in `src/shared/miniapp-target.util.ts` (`<miniAppId>[/path]`, shared with map `miniapp` buttons and pushes) |
| Envelope | `{ meta, data }` via the global `ResponseInterceptor` |
| Tests | `__tests__/nest/miniapps/` |

The registry is one dataset, the same for every client and every language: a push reaches every
replica within 60 seconds, with no deploy, and the app's 5-minute `Cache-Control` on top. A replica
that has never read a good registry answers `503 MINIAPP_REGISTRY_UNAVAILABLE`, with no
`Cache-Control`, on every route here. The broadcast log (`sent_notifications`) is kept in the
miniapps database — see §5.

## 2. `GET /miniapps` — the index

`Cache-Control: public, max-age=300`. Like every response a shared cache may store, `meta` names no
language: Cloudflare keys its edge copy without `Accept-Language`.

```json
{
  "meta": {},
  "data": {
    "version": 1,
    "miniApps": [
      {
        "id": "eskara-2026",
        "name": "축제 가이드",
        "order": 5,
        "homeLogo": { "kind": "emoji", "emoji": "📖" },
        "shellLogo": { "kind": "remote", "uri": "https://media.skkuverse.com/miniapps/eskara-2026/logo-03a86934.jpg" }
      }
    ]
  }
}
```

| Field | Meaning |
| --- | --- |
| `version` | The dataset's `index.version`. Bumped only on a breaking schema change; not gated on by any released client yet |
| `miniApps` | Ordered by `order` ascending (`toMiniAppRegistry` sorts once per revision) |
| `id` | Stable kebab-case slug: the deep-link path (`/m/<id>`), the cache key, the key of its detail under `details`. Never the display name, so it survives a rename or a translation |
| `name` | Full service name — shell header, share sheet |
| `shortName` | Optional short label for the home grid tile; the client falls back to `name` |
| `homeLogo`, `shellLogo` | Always both present on the wire, images resolved to an absolute URL. See §2.1 |
| `hidden` | `true` removes the tile from the home grid only. The entry stays in the index: a deep link, a map `miniapp` button, and the shell's own header all resolve a mini app through this index, and hiding a tile must not break any of those. Absent means listed |

Nothing else is on the wire. The index entry's stored shape (`MiniAppIndexEntryRaw`) allows exactly
`id`, `name`, `shortName`, `order`, `homeLogo`, `shellLogo`, `hidden` — an unknown key refuses the
push, rather than being silently ignored (§4).

### 2.1 Logos

An index entry authors at least one of `homeLogo` (the home grid tile) or `shellLogo` (the shell's
title pill and page-info sheet); whichever is absent is filled from the other, so the wire always
carries both. Only a mini app whose grid tile and shell header should differ authors both — ESKARA is
the one case today: a 📖 emoji on the tile, its poster inside the shell.

On disk, a logo is one of three shapes:

| `kind` | On disk | On the wire |
| --- | --- | --- |
| `emoji` | `{ "kind": "emoji", "emoji": "😋" }` — exactly one emoji, checked by grapheme (`Intl.Segmenter`), not code point | passed through unchanged |
| `remote` | `{ "kind": "remote", "path": "/miniapps/<id>.png" }` — site-root-relative, under `WEB_ORIGIN` | `{ "kind": "remote", "uri": "<WEB_ORIGIN><path>" }` |
| `media` | `{ "kind": "media", "url": "https://media.skkuverse.com/…" }` — an absolute URL on the R2 media bucket, checked with `isMediaUrl` | `{ "kind": "remote", "uri": "<url>" }` |

Both on-disk image spellings collapse into one wire shape (`{ kind: "remote", uri }`), so the client
only ever needs to branch on `emoji` vs `remote`. The raw `path`/`url` fields never reach the wire.

## 3. `GET /miniapps/:id` — the detail

`Cache-Control: public, max-age=300`, set only on a 200 — an id that ships in a later deploy must not
stay a cached 404. An unknown id throws `AppError("MINIAPP_NOT_FOUND", …, 404)`.

```json
{
  "meta": {},
  "data": {
    "version": 1,
    "id": "booth-box",
    "startUrl": "https://booth-box.mini.skkuverse.com/",
    "verified": true,
    "relatedLinks": [],
    "shell": { "bar": "top", "header": "opaque", "statusBar": "dark", "background": "#FFFFFF" }
  }
}
```

| Field | Meaning |
| --- | --- |
| `version` | `1`, per-file |
| `id` | Matches the index entry; `checkedRegistry` refuses a push whose detail `id` disagrees with its key |
| `startUrl` | The mini app's home destination — where the shell navigates on open |
| `verified` | Shows the verified badge in the page-info sheet |
| `description` | Optional, the page-info sheet's blurb |
| `relatedLinks` | `{ label?, url }[]`, every `url` an absolute `http(s)` URL |
| `noticeBanner` | Optional `{ title, subtitle }` |
| `shell` | Always the complete merged config — see §3.1 |

### 3.1 `shell` is always a complete object, merged in one fixed order

Every field of `shell` — `bar`, `header`, `statusBar`, `background` — is present on the wire, even
though every one of them is optional on disk. The response is built by merging three layers, weakest
first:

```text
mergeShell(mergeShell(DEFAULT_SHELL, the registry detail's shell), the mini app's own manifest)
```

| Layer | Source | Optional? |
| --- | --- | --- |
| `DEFAULT_SHELL` | `src/miniapps/catalog/miniapps-catalog.constants.ts` — `{ bar: "bottom", header: "opaque", statusBar: "dark", background: "#FFFFFF" }` | always applies |
| Registry shell | The detail's own `shell` object in the `miniapps` dataset | authored per mini app, every field optional |
| Manifest shell | The mini app's own `public/skkuverse.json` at `/skkuverse.json` on its origin, fetched by the poller's `miniapps-manifest.client.ts` and read back from `miniapp_manifests` | stored only for a first-party origin (§3.2); falls back to `{}` (no override) otherwise |

| Field | Values | Meaning |
| --- | --- | --- |
| `bar` | `top` \| `bottom` \| `none` | Where the shell draws the service-name pill: `bottom` (a floating bar with back/forward), `top` (in the header, no bottom bar), `none` (no pill, no back/forward — for a page that draws its own chrome) |
| `header` | `opaque` \| `overlay` | `opaque` is a solid header band with the page starting below it; `overlay` starts the page at the top of the screen, under a transparent header and status bar |
| `statusBar` | `dark` \| `light` | Status bar icon colour: `dark` icons for a light page, `light` for a dark one |
| `background` | `#RRGGBB` | Painted behind the WebView while loading and on overscroll |

The client parses tolerantly (an unknown key or a bad value is dropped, the default takes its place),
but the registry's own copy of the same fields is validated strictly at push — see §4.

### 3.2 Manifest fetch rules

`src/miniapps/manifest/miniapps-manifest.client.ts` fetches `<origin>/skkuverse.json` for a first-party
origin and keeps the result's `shell` fields. Only the poller fetches; the detail route reads what it
stored:

- **The poller** (`MiniappsManifestPoller`, wherever pollers run, `ROLE=poller` or `combined`) fetches
  every origin on `FIRST_PARTY_MINIAPP_ORIGINS` once at start and then every 4 minutes
  (`POLL_INTERVAL_MS`), one poller per origin named `miniapp-manifest-<hostname>`. Each fetch stores
  `{ _id: <origin>, shell, fetchedAt }` in the miniapps database's `miniapp_manifests` collection. A
  failed fetch rejects that origin's tick (`poller.failing`, then `poller.still_failing`) and leaves the
  stored document as it was, so the last good manifest stays; the other origins keep polling. A
  development poller fetches the same production origins, since a mini app has no development origin,
  and writes the `_dev` database.
- **The detail route** (`GET /miniapps/:id`, `MiniappsManifestService.shellFieldsFor`) fetches nothing,
  at boot or on request. For a mini app whose `startUrl` is on a first-party origin it takes that
  origin's stored document and merges its `shell` fields, parsed again by `parseShellFields`, over the
  registry's. A third-party mini app reads nothing.

The fetch rules are the poller's:

- **Origin allowlist:** only an origin on `FIRST_PARTY_MINIAPP_ORIGINS` (`src/infra/origins.ts`) is
  treated as first-party — an explicit list, not a host pattern, so `eskara.miniapp.skkuverse.com`
  (whose shape predates the `.mini.skkuverse.com` convention) is fetched like the rest, and an
  unlisted `*.mini.skkuverse.com` host is not. `https` only, no exceptions.
- **Timeout:** `FETCH_TIMEOUT_MS` = 3 000 ms, aborted via `AbortController`.
- **Size cap:** `MAX_MANIFEST_BYTES` = 16 KiB, enforced both on `Content-Length` (when present) and on
  the actual bytes read — a lying or absent header cannot bypass the cap.
- **Redirects rejected:** fetched with `redirect: "manual"`; an `opaqueredirect` response or a raw 3xx
  status is treated as a failure, never followed.
The read rules are the detail route's:

- **One cached read for every origin:** `listManifests(FIRST_PARTY_MINIAPP_ORIGINS)`, one bounded `find`
  projected to the shell, held for `MANIFEST_CACHE_TTL_MS` = 60 s. Past the TTL the next request waits
  for the reload (`serveStale: "on-reload-failure"`), so a manifest change on an origin reaches every
  replica within the 4-minute poll plus that minute: 5 minutes, as before the poller.
- **A down origin keeps its last good manifest** in the stored document, for as long as it stays down;
  the poller replaces it only with a fetch that succeeded.
- **A failed read after a good one** serves the last read for `MANIFEST_STALE_WINDOW_MS` = 24 hours
  (`cache.reload_failed`).
- **No stored document, or no good read yet → `{}`.** An empty override merges as "no change", so the
  mini app's detail response keeps showing exactly the registry's own shell (already merged over
  `DEFAULT_SHELL`), with status 200: a manifest only restyles the shell. A read that fails with none
  cached logs `miniapps.manifest.read_failed` (warn, at most once every 10 minutes, with `suppressed`).

**Identity stays with the registry.** The manifest may change presentation only — the four `shell`
fields — never `startUrl`, `name`, `verified`, or the logos. Those live in the `miniapps` dataset,
are validated at push, and change only with a push.

### 3.3 The shell parser is a mirrored copy, not an import

`parseShellFields` in `src/miniapps/miniapps.mapper.ts`, and `mergeShell` and `parseManifest` in
`src/miniapps/catalog/miniapps-catalog.mapper.ts` (with `DEFAULT_SHELL` beside them), are a hand-copied port of
`packages/miniapp/src/protocol/manifest.ts` in the `skkuverse-miniapp` repo (the `@skkuverse/miniapp`
SDK's `/protocol` subpath), not an import of it. `@skkuverse/miniapp` is ESM-only
(`"type": "module"`, no `require` export condition) and this server compiles as CommonJS, so a normal
`require()`/`import` of the package fails at load time rather than merely at typecheck time. Rather
than loosen the server's module settings for one dependency, the tolerant-parsing logic is copied
here by hand.

Keeping the two in step is a manual discipline: a field added to the SDK's manifest needs the matching
field added here, and `src/miniapps/catalog/miniapps-catalog.mapper.spec.ts` (with the field-by-field
cases in `src/miniapps/miniapps.mapper.spec.ts`) mirrors the vectors in
`skkuverse-miniapp`'s `packages/miniapp/test/protocol.test.ts` `manifest` block, so a divergence shows
up as a test failure on whichever side falls behind. The shared protocol both sides are keeping in
step with is documented in
[skkuverse-miniapp's protocol reference](https://github.com/spencer0124/skkuverse-miniapp/blob/main/docs/reference/protocol.md).

## 4. Push validation

`npm run data -- push miniapps` runs the server's own checks from the pushing checkout and writes
nothing while any issue stands: every problem is listed at once, each with its path
([how-to/edit-runtime-data.md](../how-to/edit-runtime-data.md)). The read parses the stored document
again (`storedRegistry`), so a document no push wrote is never served: a missing or invalid one logs
`miniapps.registry.missing` or `.invalid` at error, and the replica keeps its last good revision.

This is deliberately **strict**, unlike the tolerant manifest parsing of §3.1–§3.2. The registry is
our own data — a typo is refused at the operator's terminal, not degraded around at read. The
manifest, by contrast, is an untrusted remote payload the mini app's own origin serves, and a broken
one must never take the detail response down with it; `parseShellFields` and `parseManifest` drop
what they cannot read and fall back to defaults instead.

`checkedRegistry` refuses, among other things:

- duplicate `id`s in the index, or an `id` that does not match `^[a-z0-9-]+$`;
- an index entry with a key outside the allowed ones (§2): an old `logo` field or a misspelt
  `homelogo`;
- an index `id` with no detail under `details.<id>`, a detail with no index entry, or a detail whose
  `id` differs from its key;
- no `homeLogo` or `shellLogo`, or a malformed one (§2.1);
- a `startUrl` that is not `http(s)`, or that lands on `WEBVIEW_ORIGIN` without addressing a real page
  (a fragment or the bare origin; our web view routes by path). Third-party hosts route however they
  like and are exempt;
- a `shell`, `relatedLinks` entry or `noticeBanner` with an undeclared key, or a shell value outside
  the closed set §3.1 lists.

`toRegistryIssues` holds the registry to the first-party owners in code
(`MINIAPP_ID_BY_FIRST_PARTY_ORIGIN`, `src/infra/origins.ts`): each owner is registered with its
`startUrl` on its own origin, no other mini app starts there, and a `startUrl` on a `skkuverse.com`
host is a first-party origin or the web view. At read, a mismatch logs
`miniapps.registry.owner_mismatch` at error once per revision, and the registry still serves.

The push also refuses dropping an id that a stored `home-layout`, `campus-banners` or
`transit-layout` still names, naming that dataset, its path and the id; those datasets' own pushes
check their mini app ids and targets against the `miniapps` stored in the same database.

## 5. Notification endpoints

The broadcast feed is the one part of the mini-app surface backed by Mongo (`sent_notifications`, in
its own database per `config.miniapps.dbName`) rather than static JSON — see `SentNotificationDoc` in `src/miniapps/miniapps.document.ts` and the
[module doc](../explanation/miniapps-architecture.md) for why it is broadcast-only with no per-user read state.

### 5.1 `GET /miniapps/:id/notifications` (public)

No auth — the feed carries no user dimension. `Cache-Control: private, max-age=3`: private because
`title`/`body` are in the request's language and Cloudflare keys its edge copy without
`Accept-Language`, and deliberately no longer than the server's own cache: this is read seconds after a push woke the device, so a longer
device-side copy would show the feed without the entry to exactly the person the notification was for. 404s with `MINIAPP_NOT_FOUND` for an unregistered
id, same as §3.

Returns up to `config.miniapps.feedLimit` (50) entries, newest first, each `{ id, title, body, sentAt,
actionType?, actionValue? }`. `title`/`body` resolve to the requester's language with a Korean
fallback (`en` when `Accept-Language` says so and the row has one, `ko` otherwise).

Every client that shows the feed reads this route, all at once seconds after a push, so each replica
serves it from an in-process `createCachedLoader` per mini app (`FEED_CACHE_TTL_MS`, 3 s) instead of
querying Mongo per request, so Mongo sees at most one query per replica per 3 s however many clients
read. The language is applied after the read, so `ko` and `en` share one query. There is no stale
window: the first read after an expiry waits for one shared query rather than being handed the
pre-push copy. A send clears the sending replica's cache after its insert; every other replica's copy
is at most 3 s old, well inside the time a push takes to fan out and be tapped.

### 5.2 `POST /miniapps/:id/notifications` (signed)

Auth is a signature by a key the mini app in the path registered, under the `push.send` scope (§5.4),
which `MINIAPP_PUSH_AUTHORIZER` checks ([ADR 0023](../decisions/0023-perimeter-ports.md)). No Firebase
auth. The general rate limit of `/miniapps` applies, and each send counts against the sender's
configured quotas.

Required header `Idempotency-Key`: 1–128 characters of `A-Z`, `a-z`, `0-9`, `_` and `-`. A send
without one is `400 INVALID_IDEMPOTENCY_KEY` (`a signed send needs an Idempotency-Key`), and any other
value is `400 INVALID_IDEMPOTENCY_KEY` (`Idempotency-Key must be 1-128 characters of A-Z, a-z, 0-9, _
and -`), with nothing written or sent. The registry is read first (503), then the signature is checked
(401, 403), then the `id` (404), then the key, then
the body, then the sender's quota (`429 RATE_LIMIT` with `Retry-After`, nothing written or sent; never for a
refused body or a repeat). A send stores its key on its row; a later or concurrent send with the
same key for the same mini app answers `200` with the first send's body
(`{ notificationId, delivery, outcome, error? }`, `error` as stored, cut to 500 characters) and never
calls the Cloud Function again, whatever that outcome was ([ADR 0020](../decisions/0020-miniapp-push-link-policy.md), D5):

| The first send's row | A repeat answers |
| --- | --- |
| delivered | `outcome: "delivered"` with its `delivery` counts |
| `not_sent` or `unknown` | that `outcome` and its stored `error`, `delivery: null` |
| no outcome yet (still running, or its result never saved) | `outcome: "unknown"`, `delivery: null`, `error` saying so |

A repeat must carry the same notification: its `title_ko`, `body_ko`, `title_en`, `body_en`,
`actionType`, `actionValue`, `chipId` and `placeId`, as checked and trimmed, equal the stored row's, or it is
`422 IDEMPOTENCY_KEY_REUSED` (`Idempotency-Key was already used for a different notification; send
this one with a new key`) with nothing written or sent, also when it loses a race to the first. To
resend after a `not_sent`, use a new key. The same key under another mini app, or a different key, sends as
usual. The key is unique through the index `miniAppId_idempotencyKey_unique` on `sent_notifications`,
which the poller creates at boot (ADR 0012, D3); until it exists, a sequential repeat is still answered
from the stored row, and only two concurrent sends with one key could both send.

Body: `{ title_ko, body_ko, title_en?, body_en?, actionType?, actionValue?, chipId?, placeId? }`. `actionType`, when set,
must be one of `route`, `webview`, `external`, `miniapp` — the app's navigable set — and
`actionValue` is required and checked as sent, untrimmed ([ADR 0020](../decisions/0020-miniapp-push-link-policy.md)):

| `actionType` | `actionValue` must be | 400 `INVALID_PAYLOAD` message |
| --- | --- | --- |
| `route` | exactly one of the allowed routes `PUSH_CONTENT_POLICY` holds ([ADR 0023](../decisions/0023-perimeter-ports.md)) or `/miniapp-feed/<id>`, where `<id>` is the URL path's `:id`, the sender itself, with no query string or trailing `/` | `actionValue for route must be one of [<the routes>, /miniapp-feed/<id>]`, with the sender's id in place of `<id>` |
| `webview`, `external` | an `https://` URL that parses, with a host, no userinfo, and no whitespace, `\`, control or format character | `actionValue for <actionType> must be an https:// URL with no whitespace` |
| `miniapp` | a [mini-app target](#6-the-mini-app-target-grammar) | `actionValue for miniapp must be a mini-app target: <miniAppId>[/path]` |
| `miniapp` | naming a mini app the registry holds: the sender or another, `hidden` or not, never an unregistered id or a first-party game (`GAME_ID_BY_FIRST_PARTY_ORIGIN` in `src/infra/origins.ts`), even one a registry lists. The registry is the snapshot the `id` was checked against ([ADR 0020](../decisions/0020-miniapp-push-link-policy.md), D2) | `actionValue for miniapp must target a registered mini app` |

A URL or another screen is not a `route`: `/webview?url=…`, `/mini-app?id=…` and `/games/<id>` are refused.
Nothing is written or sent on a 400.

`chipId?` and `placeId?` name where a current app opens the map for the push: a route stays one of the
screens above (`/campus` for the map), and these ride beside it as extra data keys, which installed builds
ignore (skkuverse-app ADR 0022, decision 7). Absent or `null` is no key. They are stored on the row,
sent to the Cloud Function, and compared on an Idempotency-Key repeat like the action:

| Key | Must be | 400 `INVALID_PAYLOAD` message |
| --- | --- | --- |
| `chipId` | 1-64 characters of `a-z`, `0-9`, `_` and `-`, starting with a letter or digit (`day1`, `eskara-2026_all`) | `chipId must be 1-64 characters of a-z, 0-9, _ and -, starting with a letter or digit` |
| `placeId` | the app's place reference `[<kind>:]<id>`: `<kind>` one of `PUSH_PLACE_KINDS` (`skku_building`, `event`, `bus_stop`, `subway_station`), `<id>` 1-128 characters of `a-z`, `0-9` and `-`; a bare id is an event place (`bus_stop:hssc-600th`, `subway_station:hyehwa`) | `placeId must be [<kind>:]<id>, kind one of skku_building, event, bus_stop, subway_station and id 1-128 characters of a-z, 0-9 and -` |

The Cloud Function (maintained outside this repository) copies a fixed list of keys into
the device's data, and that list does not hold `chipId` or `placeId` yet: until it does, a device
receives the push without them and opens the route alone. The public feed and the sender's history do
not serve them.

The write order is feed-first: the row is inserted (minting the notification id), then the Cloud
Function is called, then whatever it reports is patched back onto the row. A failed call leaves
`delivery: null` on the row rather than deleting it, and the response (and the row's
`deliveryError`) carries an `outcome` saying whether it may be retried:

| `outcome` | When | Retry? |
| --- | --- | --- |
| `delivered` | the function answered 2xx; `delivery` has the counts | no |
| `not_sent` | 400/401/403/404/405/413/429 — refused before any send (payload, key, or the platform) | yes, after fixing the cause |
| `unknown` | timeout, network error, 5xx, or any other status — the function keeps sending after the caller stops waiting, and a 5xx can follow a partial send | **no** — check the Cloud Function log for the `notificationId` first |

A `503 MINIAPP_REGISTRY_UNAVAILABLE` comes before the feed-first write: the replica checks the `id`
against the registry before it inserts the row, so nothing is written or sent and the response
carries no `outcome`. It is safe to retry once `npm run data -- check miniapps --prod` passes.

A call whose *result* fails to record is logged but reported as delivered, since the push has already
reached devices by then and re-sending would double it. Every step logs the `notificationId` with the
title's first 80 characters, the action, the outcome and the round-trip time, so one send can be
traced through `docker logs` and matched to the Cloud Function's `miniapp.dispatch.complete` line.

### 5.3 `GET /miniapps/:id/notifications/history` (signed)

Auth is a signature under the `push.history` scope (§5.4), with the 401, 403, 404 and 503 of §5.2.
Returns the same rows as §5.1 but for the sender:
`{ id, title_ko, body_ko, title_en, body_en, actionType?, actionValue?, sentAt, delivery,
deliveryError, idempotencyKey }`, where `delivery` is `{ sent, failed, cleanedUp }` or `null`, and
`deliveryError` is `{ outcome: "not_sent" | "unknown", error }` when the call failed (null otherwise).
`idempotencyKey` is the key the send carried, or `null` on a row stored before every send carried one; the public feed (§5.1) never serves it.
`sent` is how many devices a send reached. Uncached and `Cache-Control: no-store`, since a sender reads it to learn
what just happened. It cannot settle an `unknown` on its own — only the Cloud Function log can.

`delivery` and `deliveryError` **both null** means the call is still running (up to 30 s), or it
finished but its result was never saved (a failed record write, a crashed process, a row from before
`deliveryError` existed). Treat it as `unknown`: check the Cloud Function log for the
`notificationId` before resending.

### 5.4 Signed calls

A mini app's own backend sends and reads its history on public routes, signing each call with an
Ed25519 key whose public half is registered in its registry entry
([how-to/register-a-miniapp.md](../how-to/register-a-miniapp.md), "Register a signing key"). The
server stores only public keys.

| Route | Scope | Answers |
| --- | --- | --- |
| `POST /miniapps/:id/notifications` | `push.send` | as §5.2 |
| `GET /miniapps/:id/notifications/history` | `push.history` | as §5.3 |

History is not `GET /miniapps/:id/notifications`: that path is the public feed (§5.1), which a shared
cache may serve. Both routes are under the general rate limit of `/miniapps`, and a send also counts
against the sender's configured quotas (per hour and per day) and a global ceiling, shared by every
replica.

Every call carries these headers:

| Header | Value |
| --- | --- |
| `X-Skkuverse-Key-Id` | The `keyId` of the registered key that signed |
| `X-Skkuverse-Timestamp` | The current time in whole Unix seconds, as 1 to 12 decimal digits with no leading zero |
| `X-Skkuverse-Signature` | The Ed25519 signature of the string to sign, base64url without padding (86 characters) |
| `Idempotency-Key` | Required on `POST` (the §5.2 format); not sent on `GET` |

The string to sign is UTF-8 text of six fields joined by `:`:

```text
v1:{timestamp}:{method}:{target}:{idempotency key}:{body sha256}
```

- `timestamp`: the value of `X-Skkuverse-Timestamp`, exactly as sent.
- `method`: `POST` or `GET`, upper case.
- `target`: the request target exactly as sent: the path, then `?` and the query string when the URL has
  one, with no normalization. The query is signed so that a parameter cannot be changed in flight.
  Send the path exactly as listed above: lower case, no trailing slash. Any other spelling arrives
  without its raw body and is refused.
- `idempotency key`: the `Idempotency-Key` value; empty on `GET`. Its format holds no `:`.
- `body sha256`: the lowercase hex SHA-256 of the body bytes exactly as sent. A `GET` has no body, so
  it is the hash of zero bytes, `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

A `GET` history call therefore signs `v1:{timestamp}:GET:/miniapps/<id>/notifications/history::e3b0…b855`.
Because the idempotency key is signed, a captured send cannot be replayed under a new key, and a
replay under its own key answers the stored outcome without sending again.

The server refuses, in this order:

| Status | Code | When |
| --- | --- | --- |
| `401` | `UNAUTHORIZED` | A header is missing or malformed; the timestamp is more than 300 seconds from the server's clock; the key id is not registered to the path's `:id` (another mini app's key included, and any key for an unregistered `:id`, so `401` comes before `404`); the signature does not verify; the body was sent with a `Content-Encoding` |
| `403` | `FORBIDDEN` | The signature verifies, but the mini app's `status` is not `active`, or its `scopes` lack the route's scope |
| `404` | `MINIAPP_NOT_FOUND` | Only after a call is authenticated |
| `400` | `INVALID_IDEMPOTENCY_KEY` | A signed send without `Idempotency-Key` (`a signed send needs an Idempotency-Key`), or one in the wrong format |
| `400` | `INVALID_PAYLOAD` | The body, as §5.2 |
| `429` | `RATE_LIMIT` | The rate limit, or the sender's quota or the global ceiling, with `Retry-After` in seconds; nothing written or sent |

These routes take no `X-Internal-Token`: a call with no signature is `401`, whatever token it carries.
No route under `/internal/miniapps` exists ([ADR 0020](../decisions/0020-miniapp-push-link-policy.md), D6).

Signing in Node, with nothing but `node:crypto`:

```js
import crypto from "node:crypto";

// privateKeyPem: the PKCS#8 PEM the key-issuing tool wrote; keyId: the keyId it printed.
export async function sendPush({ miniAppId, keyId, privateKeyPem, notification, idempotencyKey }) {
  const target = `/miniapps/${miniAppId}/notifications`;
  const body = JSON.stringify(notification);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodySha256 = crypto.createHash("sha256").update(body, "utf8").digest("hex");
  const stringToSign = `v1:${timestamp}:POST:${target}:${idempotencyKey}:${bodySha256}`;
  const signature = crypto.sign(null, Buffer.from(stringToSign, "utf8"), crypto.createPrivateKey(privateKeyPem)).toString("base64url");
  return fetch(`https://api.skkuverse.com${target}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Skkuverse-Key-Id": keyId,
      "X-Skkuverse-Timestamp": timestamp,
      "X-Skkuverse-Signature": signature,
    },
    body,
  });
}
```

Send the same `body` string you hashed: a client that serializes the object again may produce other
bytes. Keep the `Idempotency-Key` of a send you retry, so a retry after a timeout answers the first
send's outcome instead of pushing twice.

#### Known-answer vector

Check a signer against this vector before it calls the server. The key is the published test key of
[RFC 8032](https://www.rfc-editor.org/rfc/rfc8032#section-7.1) section 7.1, TEST 1 (secret
`9d61b19d…7f60`, public `d75a9801…511a`), so never register it. Ed25519 signatures are deterministic:
the same key and string give the same `signature`. The server's tests read this block.

```json
{
  "privateKeyPem": "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIJ1hsZ3v/VpguoRK9JLsLMREScVpezJpGXA7rAMcrn9g\n-----END PRIVATE KEY-----\n",
  "publicKey": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
  "keyId": "21fe31dfa154a261",
  "method": "POST",
  "target": "/miniapps/example/notifications",
  "timestamp": "1761451200",
  "idempotencyKey": "send-0001",
  "body": "{\"title_ko\":\"test\",\"body_ko\":\"hello\"}",
  "stringToSign": "v1:1761451200:POST:/miniapps/example/notifications:send-0001:a0ee18224314140664804d4d8e896ce7e34dd1a10e42192a89dfe35037ff4540",
  "signature": "Elb1RB3MM5W2Wb_5Hd_UmdXNHqYW95uXkXTD76ZUM_TRjF-uSobVutN8h1oBhkQ-q1NKcY_6XpTWTjN01qINDQ"
}
```

## 6. The mini-app target grammar

`parseMiniAppTarget` in `src/shared/miniapp-target.util.ts` defines the one string grammar every place that opens a mini app
uses — a map `miniapp` button action, this section's push `actionValue`, and the app's `/m/<target>`
deep link (this string with `/m/` in front):

```text
<miniAppId>[<root-relative path>]

eskara-2026                     opens the mini app at its registered startUrl
eskara-2026/eskara/wristband    opens that page, on startUrl's origin
```

The server only validates the grammar and, where it matters (§5.2), registry membership. The path
segment is resolved against `startUrl` on the device, not here: the server's only guarantee is that
the path cannot name another host (`//evil.com` and `/\evil.com`, the two spellings a URL parser reads
as a new authority, are both refused). The app checks the resolved origin again on its side, because a
deep link never passes through this server at all.

## 7. File map

| File | Role |
| --- | --- |
| `src/miniapps/miniapps.wire.ts`, `src/miniapps/miniapps.schema.ts` | The served index entry and detail; the dataset's zod structure and cross-references (§4) |
| `src/miniapps/miniapps.repository.ts`, `src/miniapps/miniapps.document.ts` | The read of the `miniapps` dataset, parsed with `storedRegistry` |
| `src/miniapps/miniapps.mapper.ts` | `toMiniAppRegistry`: the frozen snapshot of one revision, logos resolved and the index sorted |
| `src/miniapps/miniapps.rules.ts` | Whether a target names a registered mini app (the grammar of §6 is `src/shared/miniapp-target.util.ts`), the emoji and start URL checks, and the first-party owner check (`toRegistryIssues`) |
| `src/miniapps/miniapps.service.ts` | The door: `current()` for the routes, `ui` and `map` (`findCurrent()` where the map serves without it) |
| `src/miniapps/miniapps.module.ts` | Provides the door, its repository and `Clock`, binds the rate limiter on `miniapps` |
| `src/miniapps/catalog/` | `GET /miniapps`, `GET /miniapps/:id`, `GET /miniapps/:id/notifications`; the shell merge (§3.3) |
| `src/miniapps/manifest/` | The manifest client, the poller, `miniapp_manifests` and the detail route's cached read of it (§3.2) |
| `src/miniapps/notifications/` | The signed `POST /miniapps/:id/notifications` and `GET /miniapps/:id/notifications/history` (§5.2 to §5.4): the send, the feed cache, `sent_notifications` and the Cloud Function client |
| `src/miniapps/sender/` | Every perimeter decision about a push sender: the authorizer, the content policy and the quota |
| `src/infra/origins.ts` | `WEB_ORIGIN`, `MEDIA_ORIGIN`, `MINIAPP_ID_BY_FIRST_PARTY_ORIGIN`, `FIRST_PARTY_MINIAPP_ORIGINS`, `BRIDGE_ORIGINS` — see [how-to/register-a-miniapp.md](../how-to/register-a-miniapp.md) |
| `scripts/lib/datasets/catalog.js` | The `miniapps` entry `npm run data` checks a push with |
| `__tests__/nest/miniapps/` | The route tests; each file's unit spec sits next to it in `src/miniapps/` |

## Related

- [how-to/register-a-miniapp.md](../how-to/register-a-miniapp.md) — the server-side steps to add a
  new mini app
- [how-to/configure-home.md](../how-to/configure-home.md) — how a registered mini app is placed on the home
  screen
- [skkuverse-miniapp protocol reference](https://github.com/spencer0124/skkuverse-miniapp/blob/main/docs/reference/protocol.md) —
  the bridge protocol a mini-app page and the app speak, and the manifest shape `parseShellFields` mirrors
