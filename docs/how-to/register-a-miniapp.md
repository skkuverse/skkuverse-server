---
title: Register a Mini App
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-27
audience: internal
---

# Register a Mini App

> The server half of adding, editing or removing a mini app in `GET /miniapps`: the `miniapps`
> dataset you push with `npm run data`, the first-party origin a page we host needs in code, the
> order of a registry push, a layout push and a deploy, and how to check each step in production.
> The wire contract is [reference/miniapps-api.md](../reference/miniapps-api.md). Building the page
> itself is a separate, cross-repo procedure:
> [skkuverse-miniapp's create-a-miniapp how-to](https://github.com/spencer0124/skkuverse-miniapp/blob/main/docs/how-to/create-a-miniapp.md).
> A page is deployed only after it passes the
> [miniapp spec](https://github.com/spencer0124/skkuverse-miniapp/blob/main/docs/reference/miniapp-spec.md)
> check, whose identity rules (the id pattern, the `<id>.mini.skkuverse.com` host) match this registry's.

## Overview

The registry is the `miniapps` dataset in the content database
([ADR 0013](../decisions/0013-runtime-data-in-mongodb.md)), one document edited with `npm run data`
like any other dataset ([edit-runtime-data.md](edit-runtime-data.md)). Its data is
`{ "index": { "version": 1, "miniApps": [ … ] }, "details": { "<id>": { … } } }`: an index entry per
mini app (name, logos, order, `hidden`) and a detail per mini app (start URL, shell, page-info sheet).
Every api replica serves a push within 60 seconds, with no deploy; the app may keep its copy of
`/miniapps` for 5 more minutes.

A push is checked with the server's own code from your checkout, and refused with every issue and
its path before anything is written:

- the schema: unknown keys, an id that is not a slug, a missing or off-host logo, a `startUrl` the
  web view cannot serve, a bad shell value, a duplicate id, an index entry and a detail that do not
  agree;
- the first-party owners in `MINIAPP_ID_BY_FIRST_PARTY_ORIGIN` (`src/infra/origins.ts`): each owner
  is registered with its `startUrl` on its own origin, no other mini app starts there, and a
  `startUrl` on a `skkuverse.com` host is a first-party origin or the web view;
- the datasets that name a mini app (`home-layout`, `campus-banners`, `transit-layout`): a push that
  drops an id one of them still names is refused, naming the dataset, its path and the id;
- the games registry: mini apps and games share one id namespace, so an id the target database's
  `games` lists is refused ([reference/games-api.md](../reference/games-api.md)).

Two things stay out of the dataset. A **first-party mini app** (one we host) also needs its origin and
owner in `src/infra/origins.ts`, a code change: that entry grants its bridge, has the manifest poller
fetch its shell, and makes the app open links to it in its own shell. A **home screen tile** is a
`miniapp` tile in the `home-layout` dataset ([configure-home.md](configure-home.md)).

## Prerequisites

- The mini app is built and deployed at its own origin, `https://<id>.mini.skkuverse.com` for a
  first-party app, per skkuverse-miniapp's runbook linked above.
- What [edit-runtime-data.md](edit-runtime-data.md#prerequisites) asks for: a `.env` from
  `npm run env:pull`, and `git config user.email`.
- For a first-party mini app: a checkout of `dev` in `skkuverse-server`.

## Steps

### Add or edit a third-party mini app

1. Pull the registry: `npm run data -- pull miniapps`.
2. In `.data/dev/miniapps.json`, add an entry to `data.index.miniApps`:

   ```json
   { "id": "<id>", "name": "Display Name", "shortName": "Tile label", "order": 50, "homeLogo": { "kind": "emoji", "emoji": "😋" } }
   ```

   - `id`: a kebab-case slug (`^[a-z0-9-]+$`), permanent: the deep link (`/m/<id>`), the app's cache
     key and the analytics id all key off it.
   - `order`: the ascending position among every entry; builds that predate `GET /ui/home` draw their
     grid in this order.
   - `homeLogo` / `shellLogo`: at least one; the absent one is filled from the other. The three logo
     shapes and their allowed hosts are in [reference/miniapps-api.md §2.1](../reference/miniapps-api.md#21-logos).
   - `hidden: true` keeps it out of an old build's grid while a deep link, a map button and its own
     shell still reach it.

   Those seven keys (`id`, `name`, `shortName`, `order`, `homeLogo`, `shellLogo`, `hidden`) are the
   whole allow-list.
3. Add its detail under `data.details`, keyed by the same id:

   ```json
   "<id>": { "version": 1, "id": "<id>", "startUrl": "https://example.com/", "verified": false, "relatedLinks": [] }
   ```

   `description`, `noticeBanner` and `shell` are optional. A third-party page has no manifest, so its
   `shell` is set here for good.
4. Push to `_dev`, then make the same edit in production:

   ```bash
   npm run data -- push miniapps --note "register <id>"
   npm run data -- pull miniapps --prod
   # same edit in .data/prod/miniapps.json
   npm run data -- push miniapps --prod --note "register <id>"
   ```

To edit an existing mini app, pull, change its entry or detail, and push the same way.

### Add a first-party mini app

The origin is a trust decision held in code, so the code lands first:

1. On `dev`, add the origin and its owner to [`src/infra/origins.ts`](../../src/infra/origins.ts):

   ```ts
   export const MY_APP_MINIAPP_ORIGIN = "https://<id>.mini.skkuverse.com";

   export const MINIAPP_ID_BY_FIRST_PARTY_ORIGIN: Readonly<Record<string, string>> = Object.freeze({
     [ESKARA_MINIAPP_ORIGIN]: "eskara-2026",
     // …
     [MY_APP_MINIAPP_ORIGIN]: "<id>",
   });
   ```

   - The origin has no trailing slash: the app compares it with `new URL(pageUrl).origin`.
   - Add the origin to the literal lists in `__tests__/nest/app-config/app-config.routes.test.ts`
     ("grants the bridge to exactly these hosts, spelled out" and "maps each first-party mini-app
     origin to its mini app, spelled out"), and a row to the first-party table in
     [explanation/web-origins.md](../explanation/web-origins.md).
   - Grant it CORS, a change to the production `ORIGIN_TRUST` implementation ([ADR 0023](../decisions/0023-perimeter-ports.md)), only if the page calls this API from the browser rather than through
     the bridge. None does today.
2. From that checkout, push the registry entry as for a third-party mini app, `_dev` then `--prod`,
   with `startUrl` on the new origin and no `shell`: the page declares its shell in
   `public/skkuverse.json`, which the manifest poller stores and every `GET /miniapps/:id` merges over
   the registry's ([reference/miniapps-api.md §3.2](../reference/miniapps-api.md)).
3. Land `dev` → `main` ([cicd-and-branch-protection.md](../cicd-and-branch-protection.md)) and deploy it. Deploying is the maintainer's step, documented outside this repository.

Between the push and the deploy, the running replicas list the mini app but give it no bridge, no
manifest and no shell ownership. Keep it `hidden` and off every layout until the deploy is live.
Each of those replicas also logs `miniapps.registry.owner_mismatch` at error, once per replica per
registry revision, because its `origins.ts` does not list the new origin yet. That is expected: the
deploy ends it.

### Register a signing key

A mini app's backend sends push notifications with a signed call
([reference/miniapps-api.md](../reference/miniapps-api.md), "Signed calls"). The server stores only
the public half of each key, in the optional `sender` of the mini app's detail, which holds all three of
its fields:

```json
"<id>": {
  "version": 1, "id": "<id>", "startUrl": "https://<id>.mini.skkuverse.com/", "verified": true, "relatedLinks": [],
  "sender": {
    "status": "active",
    "scopes": ["push.send", "push.history"],
    "signingKeys": [{ "keyId": "<16 hex characters>", "publicKey": "<43 base64url characters>" }]
  }
}
```

- `status`: `pending`, `active` or `suspended`. Only `active` may send or read its history. A detail
  without `sender` is `pending`, with no scopes and no keys.
- `scopes`: `push.send` (send) and `push.history` (read what it sent).
- `signingKeys`: each `{ keyId, publicKey }` is the public half the key-issuing tool prints.
  `publicKey` is the raw 32-byte Ed25519 public key as base64url without padding (43 characters, the
  `x` of its JWK). `keyId` is the first 16 lowercase hex characters of the SHA-256 of those 32 bytes.
  A push refuses a key that is not in this format or is one of the 8 small-order Ed25519 points, a
  `keyId` that does not match its key, and a `keyId` listed twice. Leave out the tool's `miniAppId`
  and `alg` fields: they are not part of the entry.

Steps:

1. Issue a key pair with the key-issuing tool in the private companion repository. It writes the
   private key to a file outside any git work tree and prints the public half. Hand the private key to
   the mini app's backend over a private channel, then delete your local copy.
2. Push the dataset only after the deploy that knows `sender` is live and healthy on every replica.
   An image built before it refuses the whole registry and logs `miniapps.registry.invalid`. A replica
   that is already running keeps serving its last good revision, but one that boots fresh against the
   new dataset (a restart, a crash, a rollback) has no revision to keep and answers `503` on
   `/miniapps` and every route under it.
3. Pull, add `sender` to the mini app's detail, and push, `_dev` then `--prod`, as for any registry
   edit.
4. Every replica uses the new key within 60 seconds.

To roll the server back to an image older than `sender`, roll the `miniapps` dataset back first, to the
revision before `sender` was added (`npm run data -- history miniapps --prod`, then `npm run data -- rollback miniapps <revision> --prod`), and
then the image.

To rotate a key, add the new key next to the old one, switch the backend, then remove the old one.
To revoke a key, remove it. To stop a mini app's pushes at once, set `status` to `suspended`; it
takes effect within 60 seconds, with no deploy.

### Place it on the home screen

Wait a minute after the registry push, then push a `home-layout` with a `miniapp` tile, `{ "kind":
"miniapp", "id": "<id>" }`, where the tile should sit ([configure-home.md](configure-home.md#rearrange-the-grids)).
A layout push is checked against the registry stored in the database it targets, so a production
layout cannot name a mini app only `_dev` registers. A replica still holding the previous registry
leaves the tile out for up to 60 seconds and logs `ui.home_layout.item_left_out` once, then serves it.

### Remove a mini app

1. Push every layout without it: the `home-layout` tiles and feed section, and any `miniapp` action
   in `campus-banners` or `transit-layout`.
2. For a first-party mini app, land the removal of its `origins.ts` entry on `dev` first, with its
   rows in `app-config.routes.test.ts` and [explanation/web-origins.md](../explanation/web-origins.md).
   Any checkout that still lists the owner refuses the next step with
   `miniapps  details  first-party origin <origin> belongs to "<id>", which is not registered`.
3. Push `miniapps` without its index entry and detail, for a first-party mini app from that checkout.
   The push is refused while a stored dataset still names it, each line naming that dataset, its
   path and the id.
4. For a first-party mini app, deploy `dev` → `main`. Until the deploy is live, each old replica logs
   `miniapps.registry.owner_mismatch` at error once per registry revision and `/app/config` still
   maps the origin; that is expected.

The festival places in the eventmap database are not checked: a removed mini app's `miniapp` buttons
are dropped at read and logged as `map.event_overlays.actions_dropped`.

### Before a deploy that changes `origins.ts`

Run `npm run data -- check --prod` from the deploy's checkout. It checks the stored registry against
that checkout's owners, writes nothing, and exits non-zero on any issue: fix the registry first.

### Verify in production

```bash
curl -s https://api.skkuverse.com/miniapps                 # the entry, with resolved logos
curl -s https://api.skkuverse.com/miniapps/<id>            # 200, startUrl, a complete shell
curl -s https://api.skkuverse.com/app/config | jq '.data.miniapps.origins'   # first-party only
npm run data -- history miniapps --prod                    # your revision on top
```

A `?b=$RANDOM` query skips Cloudflare's five-minute edge cache.

## Troubleshooting

| What you see | Meaning | What to do |
| --- | --- | --- |
| `miniapps  index.miniApps.<n>.id  index id "<id>" has no detail` | The entry has no detail under the same id. | Add `details.<id>`, or fix the id in one of them. |
| `miniapps  details.<id>.startUrl  https://<host> is on skkuverse.com but is neither the web view nor a first-party origin in src/infra/origins.ts` | A page we host, pushed before its origin is in code. | Land the `origins.ts` change, then push from that checkout. |
| `miniapps  details.<id>.startUrl  "<owner>" owns <origin>, so its startUrl must be on it` | An owner's start page moved off its origin, or another mini app took it. | Put each first-party `startUrl` back on its own origin. |
| `miniapps  details  first-party origin <origin> belongs to "<id>", which is not registered` | You are removing a first-party mini app from a checkout whose `origins.ts` still lists it. | Land the `origins.ts` removal on `dev`, push from that checkout, then deploy. |
| `home-layout  sections.<n>.tiles.<m>.id  "<id>" is no longer in miniapps` | A layout still places the mini app you are removing. | Push the layout without it first. |
| `GET /miniapps` answers `503 MINIAPP_REGISTRY_UNAVAILABLE` | The replica never read a good registry: the dataset is missing (`miniapps.registry.missing`), fails its schema (`miniapps.registry.invalid`), or cannot be read (`miniapps.registry.read_failed`). | Run `npm run data -- check miniapps --prod`; create or roll back the dataset. |
| `miniapps.registry.owner_mismatch` at error | The stored registry disagrees with the running replica's `origins.ts`. Expected between a registry push that adds or removes a first-party mini app and the deploy of its `origins.ts` change: each old replica logs it once per registry revision. | In that window, nothing: finish the deploy. Otherwise run `npm run data -- check miniapps --prod` from the deployed checkout and push the registry it expects. |
| A bridge button does nothing on every device | The page's origin is not in `origins.ts`, or is misspelt. A third-party page never gets the bridge. | Compare the entry with `new URL(startUrl).origin`. |
| Registered, but no tile on the home screen | The layout has no tile for it, or the tile was pushed in the minute after the registry push (`ui.home_layout.item_left_out`). | Push the tile; it serves within a minute once both are stored. |

## Related

- [reference/miniapps-api.md](../reference/miniapps-api.md): the wire contract, the shell merge and the push checks
- [how-to/edit-runtime-data.md](edit-runtime-data.md): `npm run data`, history, rollback and `check`
- [how-to/configure-home.md](configure-home.md): placing a registered mini app on the home screen
- [explanation/miniapps-architecture.md](../explanation/miniapps-architecture.md): the registry snapshot and what reads it
- [skkuverse-miniapp's create-a-miniapp how-to](https://github.com/spencer0124/skkuverse-miniapp/blob/main/docs/how-to/create-a-miniapp.md): scaffolding, the Cloudflare Pages project and the custom domain
