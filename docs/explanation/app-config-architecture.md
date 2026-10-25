---
title: App Config Architecture
type: explanation
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-25
audience: internal
---

# App Config Architecture

> What `src/app-config/` tells the app at boot: the minimum version per platform, the origins the app may trust, mini app and game origins apart, and the app's kill switches. Read it before you raise a minimum version or minimum OS, add an origin or flip a switch.

## Context

App config assembles one body, the same for every client, and the app fetches it once per cold start. The values belong to their sources: the version gates to the deploy's environment, the origins and the owner of each first-party mini app and game origin to `src/infra/origins.ts`, and the kill switches to the `app-features` dataset ([ADR 0013](../decisions/0013-runtime-data-in-mongodb.md)), the one value it reads from MongoDB. That read never fails the route: with no good value every switch is served off, so a database outage never reaches the force-update gate.

| System | Quirk tag | Gives | Enters at |
| --- | --- | --- | --- |
| Doppler, through the deploy's environment | — | The minimum version, the minimum OS and the update URL per platform (`APP_IOS_MIN_VERSION`, `APP_IOS_MIN_OS_VERSION` and their siblings) | `config.app` in `src/infra/config.ts` |
| The first-party web origins | — | The origins allowed to talk to the native bridge, and the web app's origin | `BRIDGE_ORIGINS` and `WEB_ORIGIN` in `src/infra/origins.ts` |
| The first-party mini app owners | — | Each first-party mini app origin and the mini app that owns it | `MINIAPP_ID_BY_FIRST_PARTY_ORIGIN` in `src/infra/origins.ts` |
| The first-party game owners | — | Each first-party game origin and the game that owns it | `GAME_ID_BY_FIRST_PARTY_ORIGIN` in `src/infra/origins.ts` |
| `npm run data` | — | The kill switches, `{ sharedMapShell }`, pushed without a deploy | the `app-features` dataset, read by `AppConfigRepository.findFeatures` |
| skkuverse-app | — | Nothing; it reads the body at boot | `GET /app/config` |

## Glossary

| Term | Means | Derived from | Not |
| --- | --- | --- | --- |
| client config (`AppClientConfig`) | The whole `GET /app/config` body | `AppConfigService.getConfig` | `AppSettings` |
| platform gate (`platformGate`) | One platform's `minVersion`, `updateUrl` and `minOsVersion`: below `minVersion`, the app blocks on its force-update screen, unless the device OS is below `minOsVersion` | `config.app` | `forceUpdate` |
| min OS version (`minOsVersion`) | The lowest OS that can install the store build meeting `minVersion`: an iOS version (`16.4`) or an Android API level (`24`) | `APP_IOS_MIN_OS_VERSION`, `APP_ANDROID_MIN_OS_VERSION` | — |
| bridge origins | The origins whose pages may post messages to the app's native bridge | `BRIDGE_ORIGINS` | — |
| web origin | The origin of the first-party web app | `WEB_ORIGIN` | — |
| mini-app origins | Each first-party mini app's id with its origin, so the app opens such a URL in that mini app's shell | `MINIAPP_ID_BY_FIRST_PARTY_ORIGIN` | — |
| game origins | Each first-party game's id with its origin, so the app grants a page there only the game methods, for that game | `GAME_ID_BY_FIRST_PARTY_ORIGIN` | — |
| app features (`AppFeatures`) | The app's kill switches, served as `features`: `sharedMapShell` picks the shared-map shell over the NativeTabs one, so the server can switch every install back without an OTA | the `app-features` dataset, or every switch off (`APP_FEATURES_WHEN_UNREAD`) with no good value | — |

## Structure

```mermaid
flowchart LR
  env["deploy environment, from Doppler"] -->|config.app| svc["AppConfigService"]
  origins["src/infra/origins.ts"] -->|BRIDGE_ORIGINS, WEB_ORIGIN, MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, GAME_ID_BY_FIRST_PARTY_ORIGIN| svc
  dataset["app-features dataset"] -->|AppConfigRepository, cached a minute| svc
  svc -->|APP_CONFIG_CACHE_CONTROL| route["GET /app/config"]
  route -->|ios, android| gate["app: InitGate and ForceUpdateScreen"]
  route -->|webview.bridgeOrigins| bridge["app: webview and mini-app shell bridge"]
  route -->|miniapps.origins| open["app: openWebView routing"]
  route -->|games.origins| games["app: game host"]
  route -->|features| shell["app: navigation shell"]
```

What the app reads, from `skkuverse-app/packages/shared/src/schema/app-config.schema.ts` (`parseAppConfig`) and its callers:

| Field | App use |
| --- | --- |
| `ios.minVersion`, `android.minVersion` | The current platform's entry gates boot: below it, `InitGate` shows `ForceUpdateScreen` |
| `ios.minOsVersion`, `android.minOsVersion` | Below it, the gate lets the user through: the store cannot install the required build there |
| `ios.updateUrl`, `android.updateUrl` | The `ForceUpdateScreen` button opens it; `null` leaves the button inert |
| `webview.bridgeOrigins` | The allowlist every bridge message is checked against, in the web view and the mini-app shell |
| `miniapps.origins` | `openWebView` sends a URL on one of these origins to that mini app's shell |
| `web.origin` | Parsed and cached, not read |
| `games.origins` | Served and not read: the hosted game screen will check each game message's origin against it, and `openWebView` will send a URL on one of these origins to the game host |
| `features.sharedMapShell` | Served and not read yet: the app is to cache it and pick the shared-map shell or the NativeTabs one when its modules load, so a flip reaches a device at its next cold start after it fetched the new body |

## Invariants

- The body is the same for every client; it is served with `APP_CONFIG_CACHE_CONTROL`, which Cloudflare's edge also honors. A raised minimum version reaches a cold start once the replicas restart with it and that cache expires. A pushed switch reaches every replica within `DATASET_CACHE_TTL_MS`, then the edge and device caches within `APP_CONFIG_CACHE_CONTROL`.
- `/app/config` never answers `503` for the kill switches. A replica that never read a good `app-features` revision (none stored, only an invalid one, or a database that never answered) serves every switch off, the safe side of a kill switch, and logs the cause at error (`app_config.features.missing`, `app_config.features.invalid`, `app_config.features.read_failed`). One that read a good revision keeps it through failed reloads for `DATASET_STALE_WINDOW_MS`, the read contract of every dataset ([ADR 0013, D6](../decisions/0013-runtime-data-in-mongodb.md)).
- The body only grows: installed apps ignore keys they do not know, and a removed key breaks them (`CONTRACT(skkuverse-app)` on `AppClientConfig`). `features` is the last key, after every key an installed app reads.
- A game origin is served only under `games.origins`, never in `webview.bridgeOrigins` or `miniapps.origins`, so no game page gets a mini app's grants or shell ([Web origins](web-origins.md)).
- `minOsVersion` is required: a missing value, or one that is not an iOS version or an Android API level, stops an api replica at boot (`src/infra/required-env.ts`).
- In the app, a failed fetch lets the boot pass the gate and keeps the cached config, so the gate holds only when the route answers.

## Open questions

- `config.app` falls back to a built-in minimum version when `APP_IOS_MIN_VERSION` or `APP_ANDROID_MIN_VERSION` is unset, against the rule that config fails fast. Whether these become required is open.
- `web.origin` has no live reader in the app while its share and add-to-home menus are disabled.

## Related

- [Raise the minimum app version](../how-to/raise-the-minimum-app-version.md): the checklist for a new floor
- [Web origins](web-origins.md): why each first-party host is a constant, and bridge versus CORS
- [Register a mini app](../how-to/register-a-miniapp.md): adding a first-party origin and its owner
- [ADR 0010](../decisions/0010-server-architecture.md): the module shape
- [Edit runtime data](../how-to/edit-runtime-data.md#flip-an-app-kill-switch): flipping a kill switch
