---
title: Test the App Against a Local Server
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-08
audience: internal
---

# Test the App Against a Local Server

> Running `npm run dev` on a laptop and pointing a simulator or phone at it: what a local run switches off, how each device reaches the server, and what still touches production.

## Overview

A local server holds credentials that reach real people. The dev Doppler config points `FCM_FUNCTION_URL` at the Cloud Function production uses, and that function pushes by topic to every subscriber. So `NODE_ENV=development` (what `npm run dev` sets, and the default when `NODE_ENV` is unset) switches the outbound side effects off. The resolver is [`src/infra/runtime-switches.ts`](../../src/infra/runtime-switches.ts).

| Env var | development | production | What "off" means |
| --- | --- | --- | --- |
| `PUSH_DELIVERY` | `suppressed` | `live` | `postToFcmFunction` logs `push.delivery.suppressed` and returns `{ sent: 0 }` without calling the Cloud Function. Callers record it as a completed send, so `_dev` notices get `pushedAt`. |
| `RATE_LIMIT` | `off` | `on` | All four limiters skip. Locally every simulator request comes from one loopback address. |
| `BUILDING_SYNC` | `off` | `on` | The `building-sync` poller is not registered. Its warm-up crawls all of `campusMap.do` and rewrites `skkumap_dev` on every boot, and nodemon reboots on every save. |

Development also accepts loopback CORS origins (`http://localhost:*`, `http://127.0.0.1:*`), for a web dev server on the same machine. The native app is not subject to CORS.

The bus pollers (HSSC, Jongro, station) keep running locally, because the bus screens need them.

## Prerequisites

- `.env` rendered with `npm run env:pull` (Doppler `backend/dev_server`).
- A `skkuverse-app` checkout that builds natively (`npx expo run:ios` / `run:android`).

## Steps

1. Start the server:

   ```bash
   npm run dev
   ```

   The `Server started (NestJS)` line shows the switches as resolved: `push: "suppressed"`, `rateLimit: "off"`, `buildingSync: "off"`.

2. In `skkuverse-app/apps/mobile/.env`, set `EXPO_PUBLIC_BASE_URL` for the device:

   | Device | `EXPO_PUBLIC_BASE_URL` |
   | --- | --- |
   | iOS simulator | `http://localhost:3000` |
   | Android emulator | `http://10.0.2.2:3000`, or `http://localhost:3000` after `adb reverse tcp:3000 tcp:3000` |
   | Physical phone | `http://<Mac LAN IP>:3000` on the same Wi-Fi, or the https URL from `cloudflared tunnel --url http://localhost:3000` |

   The server listens on every interface, port `PORT` or 3000. Plain http works in debug builds: Expo's iOS template allows local networking and its Android debug manifest allows cleartext.

   (A credential detail is left out of the public history.)

3. Rebuild the native app: `npx expo run:ios` or `npx expo run:android`. `extra.baseUrl` is baked into the binary, so restarting Metro changes nothing (`skkuverse-app/LESSONS.md`). Builds with `EAS_BUILD_PROFILE` or `RELEASE_CHANNEL` set to `beta`/`production` ignore the variable and always use production.

4. Open a screen and check that the server's access log shows the request.

5. When you are done, remove `EXPO_PUBLIC_BASE_URL` and rebuild. Nothing on screen shows which server a dev build talks to.

### Overriding a switch

Set it on the command, like `USE_PROD_API`. These are per-run values: they are not in Doppler or `config/env.*.keys`, and a test fails if production's compose file or key lists set one.

```bash
RATE_LIMIT=on npm run dev        # reproduce a 429, or while a tunnel is up
BUILDING_SYNC=on npm run dev     # crawl campusMap.do into skkumap_dev
```

`BUILDING_SYNC=on` crawls on every boot, and `npm run dev` reboots on every save, so turn it on for a single run.

Two combinations refuse to boot (`config.invalid_runtime_switch`): `PUSH_DELIVERY=live` in development, and `RATE_LIMIT=off` in production. A real push is checked after deploying, in production.

## What still reaches production

The switches cover what the server sends out. These are shared with production regardless:

- (A credential detail is left out of the public history.)
- **Atlas.** The `_dev` databases live on the production cluster, which is billed by peak ops/s. Never load-test locally. `NODE_ENV=production` with the dev `.env` resolves production database names. To run the production image locally, use `npm run verify:serve`, which overrides them.
- **Seoul TOPIS quota.** The local bus pollers use the production service key and share its daily quota. `docs/project-docs.md` puts production's own use at about a third of it, and a full day of local polling adds about as much again.
- **Web pages.** Webview and mini-app pages inside the app load from their production hosts and call the production API, even when native screens use the local server.
- **`GET /notices/overview`.** It calls skkuverse-ai at `AI_API_URL`, a loopback address in the dev config. Without a local skkuverse-ai the overview answers "unavailable".

Sentry is off locally: the dev keys carry no `SENTRY_DSN`.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| The app still shows production data | The native build was not redone, or `EAS_BUILD_PROFILE`/`RELEASE_CHANNEL` is `beta`/`production`. On the iOS simulator, check the baked value: `grep -rao '"baseUrl":"[^"]*"' "$(xcrun simctl get_app_container booted com.example.skkumap)/EXConstants.bundle/app.config"` |
| Android cannot connect to `localhost` | Inside the emulator `localhost` is the emulator. Use `10.0.2.2` or `adb reverse`. |
| A phone cannot connect | The phone is on a different network, or the macOS firewall blocks node. A `cloudflared` tunnel avoids both. |
| Boot fails with `config.invalid_runtime_switch` | A switch has a value outside its enum, or one of the two refused combinations. |
| A local web page gets no `Access-Control-Allow-Origin` | Only `http://localhost:*` and `http://127.0.0.1:*` are allowed in development, not LAN addresses. |

## Related

- [`src/infra/runtime-switches.ts`](../../src/infra/runtime-switches.ts) — defaults and refusals
- [verify-notices-changes.md](verify-notices-changes.md) — notices checks, including a local dispatch run
- [`docker-compose.local-verify.yml`](../../docker-compose.local-verify.yml) — the production image on a laptop
- [docs/README.md](../README.md) — writing rules
