---
title: Raise the Minimum App Version
type: how-to
status: accepted
owner: spencer0124
last-updated: 2026-10-27
audience: internal
---

# Raise the Minimum App Version

> A checklist for raising `minVersion` or `minOsVersion` on `GET /app/config`, which the app's force-update gate reads at boot. Read it before you push a change to the `app-platform-gates` dataset.

## Overview

The app blocks on its force-update screen when its native version is below `minVersion` and the device OS is at least `minOsVersion`. Below `minOsVersion` the store cannot install the required build, so the gate lets the user through. `minOsVersion` is the minimum OS of the store build that satisfies `minVersion`: an iOS version (`16.4`) or an Android API level (`24`).

Each platform's gate (`minVersion`, `updateUrl`, `minOsVersion`) is in the `app-platform-gates` dataset of the content database ([ADR 0013](../decisions/0013-runtime-data-in-mongodb.md)), changed with `npm run data` and no deploy. The push refuses a gate the app cannot compare: a `minVersion` that is not three dot-separated numbers (`3.6.2`), an iOS `minOsVersion` that is not one to three (`16.4`), an Android one that is not an API level (`24`), or an `updateUrl` that is not an https address on `apps.apple.com` or `play.google.com` (no userinfo, no port). A stored `updateUrl` that fails this is served as `null` and logged at error as `app_config.platform_gates.update_url_refused`. Every api replica serves a push within 60 seconds.

## Prerequisites

- A checkout of skkuverse-server with a `.env` holding `MONGO_URL` and `MONGO_CONTENT_DB_NAME` (`npm run env:pull`), to run `npm run data` and `npm run app-gate:check`.
- `bq` logged in to project `skkubus-95723`, for the impact query.

## Steps

1. Confirm the store release is live for everyone:
   - iOS: the App Store version is at least the new `minVersion`, and its phased release has finished. During a phased release an automatic update can still deliver the old build.
   - Android: the Play release is at least the new `minVersion` and rolled out to 100%.
2. Run `npm run app-gate:check`. It compares the App Store listing (`version`, `minimumOsVersion`) with what production serves for iOS, and prints the Android values. The check runs against the current values, so a raise passes only when the store version is at least the new floor. Check by hand that the App Store `minimumOsVersion` is the `minOsVersion` you will set. For Android, read the release's minimum SDK in Play Console (App bundle explorer).
3. Count the devices the new floor gates. Set the floors at the top and run this in BigQuery. The GA4 export is final about 72 hours after a day ends, so the window stops three days back:

   ```sql
   DECLARE ios_floor STRING DEFAULT '3.6.2';
   DECLARE android_floor STRING DEFAULT '3.6.2';
   DECLARE ios_min_os STRING DEFAULT '16.4';
   DECLARE android_min_release STRING DEFAULT '7.0';  -- GA4 reports the Android release; API 24 is 7.0

   CREATE TEMP FUNCTION padded(version STRING) AS (
     ARRAY_TO_STRING(ARRAY(
       SELECT LPAD(part, 5, '0') FROM UNNEST(SPLIT(REGEXP_EXTRACT(version, r'\d+(?:\.\d+)*'), '.')) AS part WITH OFFSET o ORDER BY o
     ), '.')
   );

   WITH devices AS (
     SELECT
       device.operating_system AS platform,
       user_pseudo_id,
       ARRAY_AGG(app_info.version ORDER BY event_timestamp DESC LIMIT 1)[OFFSET(0)] AS app_version,
       ARRAY_AGG(device.operating_system_version ORDER BY event_timestamp DESC LIMIT 1)[OFFSET(0)] AS os_version
     FROM `skkubus-95723.analytics_394387547.events_*`
     WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 10 DAY))
                             AND FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 3 DAY))
     GROUP BY platform, user_pseudo_id
   )
   SELECT
     platform,
     COUNT(*) AS devices,
     COUNTIF(padded(app_version) < padded(IF(platform = 'iOS', ios_floor, android_floor))
             AND padded(os_version) >= padded(IF(platform = 'iOS', ios_min_os, android_min_release))) AS gated,
     COUNTIF(padded(app_version) < padded(IF(platform = 'iOS', ios_floor, android_floor))
             AND padded(os_version) < padded(IF(platform = 'iOS', ios_min_os, android_min_release))) AS let_through_old_os
   FROM devices
   WHERE platform IN ('iOS', 'Android')
   GROUP BY platform;
   ```

   `app_info.version` is the native version. An OTA bundle does not change it, so an OTA cannot lift a device over the gate.
4. Pull the production dataset, set the new values in `.data/prod/app-platform-gates.json`, and push it with a note. The push prints the diff and asks you to type `y`:

   ```bash
   npm run data -- pull app-platform-gates --prod
   # edit ios.minVersion and ios.minOsVersion in .data/prod/app-platform-gates.json
   npm run data -- push app-platform-gates --prod --note "iOS floor 3.6.2: <why>"
   ```

5. Verify the live body and the check, a minute or two after the push:

   ```bash
   curl -s "https://api.skkuverse.com/app/config?cb=$RANDOM" | jq '.data | {ios, android}'
   npm run app-gate:check
   ```

Every replica reads the push within 60 seconds (`DATASET_CACHE_TTL_MS`), and the edge and the app cache the body for up to 60 seconds more (`APP_CONFIG_CACHE_CONTROL` in `src/app-config/app-config.controller.ts`), so a device applies the new floor at its first cold start about two minutes after the push.

## Troubleshooting

- The push answers `REFUSED`, naming a path such as `ios.minOsVersion`: the value is not in the shape the app compares. Fix it in the working file and push again; nothing was written.
- `/app/config` answers 503 `APP_PLATFORM_GATES_UNAVAILABLE`: a replica has never read a good revision (the dataset is missing in that database, or the database never answered). The app skips its gate for that launch (it keeps no copy of the gate, only of the origins), so every device runs with no floor until the route answers again. The logs name the cause (`app_config.platform_gates.missing`, `.invalid` or `.read_failed`), and an alert on them tells the maintainer. Push the dataset; if it does not exist, create it as in [Create the dataset](#create-the-dataset).
- Users report that they cannot update: the store build is not live for them yet, or `minOsVersion` is lower than the store build's real minimum. Roll back.

## Create the dataset

The dataset holds no default, so a database without it serves no gate. Create it from the gates production serves now. Never create it from `__tests__/nest/app-config/fixtures/app-platform-gates.dataset.json`: that is test data from the 2026-10-19 capture (3.5.0), lower than production's floor, and pushing it lowers the force-update floor.

```bash
curl -s "https://api.skkuverse.com/app/config?cb=$RANDOM" | jq '.data | {ios, android}' > /tmp/app-platform-gates.json
cat /tmp/app-platform-gates.json
npm run data -- push app-platform-gates --create --file /tmp/app-platform-gates.json --prod
```

The push prints the gates it will store. Before you type `y`, check that each platform's `minVersion`, `updateUrl` and `minOsVersion` match what the `curl` returned. Run the push from a checkout whose dataset catalog (`scripts/lib/datasets/`) knows `app-platform-gates`: `origin/dev` until the change that added the dataset merges to `main`, and `main` after that. An older checkout answers `unknown dataset "app-platform-gates"`.

Create it before the deploy that first reads it: that deploy rolls back when an api replica answers `/app/config` with anything but 200.

## Rollback

Roll the dataset back to the revision before the raise, which `history` lists:

```bash
npm run data -- history app-platform-gates --prod
npm run data -- rollback app-platform-gates <revision> --prod
```

A device that already showed the update screen lets the user in again at its next cold start, once the replicas and the 60-second cache have the old floor.

## Related

- [App config architecture](../explanation/app-config-architecture.md): what `/app/config` serves and how the app reads it
- [Edit runtime data](edit-runtime-data.md): pull, push, history and rollback of a dataset
- `scripts/app-gate-check.js`: the store check
