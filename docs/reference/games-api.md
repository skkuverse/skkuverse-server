---
title: Games Registry API Reference
type: reference
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-26
audience: internal
---

# Games Registry API

> The contract for `GET /games` and `GET /games/:id`, the registry the app resolves a game id against before it opens a hosted game, what a push of the `games` dataset is checked for, and the first-party game origins the checks read. Why game origins are their own trust list is [explanation/web-origins.md](../explanation/web-origins.md); the module is [explanation/games-architecture.md](../explanation/games-architecture.md).

## Summary

| | |
| --- | --- |
| Routes | `GET /games`, `GET /games/:id` |
| Auth | none |
| Rate limit | `GeneralRateLimitMiddleware`, applied to `games` in `GamesModule.configure` |
| Wire types | `gameIndex` and `gameEntry` in `src/games/games.wire.ts`, published as `contracts/produced/games.*.schema.json` |
| Registry data | The `games` dataset in the content database, `{ games: [ … ] }`, written only by `npm run data` ([how-to/edit-runtime-data.md](../how-to/edit-runtime-data.md)) and read by `src/games/games.repository.ts` |
| Schema check | `gamesFile` in `src/games/games.schema.ts`, at every push and again at read (`storedGames`) |
| Push checks | `toGameOriginIssues` and `toTakenIdIssues` in `src/games/games.rules.ts`, run by `scripts/lib/datasets/catalog.js` |
| Game origins | `GAME_ID_BY_FIRST_PARTY_ORIGIN` in `src/infra/origins.ts` |
| Envelope | `{ meta, data }` via the global `ResponseInterceptor` |
| Tests | `__tests__/nest/games/`, `src/games/*.spec.ts` |

The registry says only whether and where the app may open a game. Whether a game is ranked, how its scores are checked, its title, copy, overlay and colors belong to skkuverse-app and its functions, keyed by the same id; the app ignores an entry it has no config for. The dataset is the same for every client and every language: a push reaches every replica within `DATASET_CACHE_TTL_MS`, with no deploy, plus the five-minute `Cache-Control` on the response. A replica that has never read a good revision answers `503 GAME_REGISTRY_UNAVAILABLE` on both routes, with no `Cache-Control`, so a client keeps the copy it cached.

## `GET /games`: the index

`Cache-Control: public, max-age=300`, with a weak `ETag` a client revalidates with. `meta` names no language. Every entry is listed, disabled ones included, in the dataset's order: a listed id is never opened from a copy the build bundles, so a disabled entry is how a game is hidden.

```json
{
  "meta": {},
  "data": {
    "games": [
      { "id": "<id>", "entryUrl": "https://<id>.game.skkuverse.com/", "enabled": true, "minHostProtocol": 1 }
    ]
  }
}
```

With no game listed, `games` is empty.

## `GET /games/:id`: one entry

The entry `GET /games` lists for that id, with the same `Cache-Control`. An id the dataset does not list answers `404 GAME_NOT_FOUND`, which no shared cache keeps.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The game's id, in the mini-app id grammar (`REGISTRY_ID_RE`): one namespace with the mini apps, so `/m/<id>` links and analytics item ids name either |
| `entryUrl` | string | The page the app's game host loads, `https` and on the origin `GAME_ID_BY_FIRST_PARTY_ORIGIN` maps to the id |
| `enabled` | boolean | `false` hides the game and sends its links home, even in a build that bundles a copy |
| `minHostProtocol` | integer, at least 1 | The lowest game protocol a host must speak; an older host hides the game. Raised only for a page change a host cannot degrade around |

## Errors

| Status | `code` | When |
| --- | --- | --- |
| 404 | `GAME_NOT_FOUND` | `GET /games/:id` for an id the revision does not list |
| 503 | `GAME_REGISTRY_UNAVAILABLE` | No good revision read yet: none stored, the stored one fails its schema, or the read failed |
| 429 | `RATE_LIMIT` | `RATE_LIMIT_POLICY` refused the request under the `general` class, with `Retry-After` ([ADR 0023](../decisions/0023-perimeter-ports.md)) |

## Push validation

`npm run data -- push games` refuses, with every issue and its path, before anything is written:

- the schema: an unknown or missing key, an id outside the grammar, an `entryUrl` that is not `https`, a `minHostProtocol` below 1 or fractional, an id listed twice;
- the origins in code: an id `GAME_ID_BY_FIRST_PARTY_ORIGIN` maps to no origin, or an `entryUrl` off that origin (another host, a port, a credential);
- the shared id namespace: an id the target database's stored `miniapps` holds. A `miniapps` push is refused the other way, for an id the stored `games` lists;
- the home layout: a push that drops an id a stored `home-layout` game tile names is refused, naming the tile's path.

A home layout `game` tile must name a game the target database's `games` lists, or one of `BUNDLED_GAME_IDS` (`src/ui/home/ui-home.constants.ts`), the games older builds bundle (≤3.6.2 embedded bundles), which open from the bundled page while unlisted on those builds only; a current build bundles no game, so it shows no tile for an unlisted one ([how-to/configure-home.md](../how-to/configure-home.md)).

A stored revision the origins in code disagree with, after a deploy that changes them, is still served and logged at error as `games.registry.owner_mismatch`, once per revision; run `npm run data -- check --prod` before such a deploy.

## Game origins

Each hosted game is served from its own Cloudflare Pages project at `https://<id>.game.skkuverse.com`, and `GAME_ID_BY_FIRST_PARTY_ORIGIN` maps that origin to the id. The map is code, never data: adding a game is a deploy that adds its origin, then a push that lists it. `GET /app/config` publishes it as `games.origins`, which the app checks each game message's origin against. A game origin is in none of the lists a mini app is trusted through, `BRIDGE_ORIGINS`, the CORS grant (`ORIGIN_TRUST`) or `MINIAPP_ID_BY_FIRST_PARTY_ORIGIN`, so the manifest pollers never fetch one and no game page gets a mini app's grants or shell; `src/infra/origins.spec.ts`, the CORS case beside the production `ORIGIN_TRUST` implementation and the `/app/config` route test pin each exclusion.

To list a game:

1. Add its origin and id to `GAME_ID_BY_FIRST_PARTY_ORIGIN` and to the spelled-out map in `src/infra/origins.spec.ts`, and deploy.
2. Pull, add the entry, and push to `_dev`, then to production:

   ```bash
   npm run data -- pull games
   # add { "id": "<id>", "entryUrl": "https://<id>.game.skkuverse.com/", "enabled": true, "minHostProtocol": 1 }
   npm run data -- push games --note "list <id>"
   npm run data -- push games --prod --note "list <id>"
   ```

3. Place a tile only after the push: a `game` tile for an unlisted, unbundled id is refused.

The first revision of the dataset is created once with `npm run data -- push games --create --file <file>` from `{ "games": [] }`, which lists no game. Until a game is listed, only a build that still bundles it (≤3.6.2 embedded bundles) opens it, from the bundled page; a current build bundles no game, so it shows no tile for it and its links land on home.

## Related

- [explanation/games-architecture.md](../explanation/games-architecture.md): the module
- [explanation/web-origins.md](../explanation/web-origins.md): every first-party host and why each list is separate
- [reference/miniapps-api.md](miniapps-api.md): the mini-app registry, which shares the id namespace
- [how-to/edit-runtime-data.md](../how-to/edit-runtime-data.md): pull, push, history and rollback
