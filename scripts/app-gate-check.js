#!/usr/bin/env node
/**
 * Check the force-update gate /app/config serves against the live store listing,
 * before and after raising a minimum version (docs/how-to/raise-the-minimum-app-version.md).
 *
 * Usage:
 *   npm run app-gate:check
 *   npm run app-gate:check -- --url http://localhost:3000/app/config
 *
 * Fails (exit 1) when the App Store version is below the served ios.minVersion,
 * when the App Store minimumOsVersion differs from the served ios.minOsVersion,
 * or when a field is missing. Google Play has no public lookup API, so the
 * Android values are printed for a manual check in Play Console.
 */
const { iosGateProblems } = require("./lib/app-gate");

// CONTRACT(skkuverse-app): ios.bundleIdentifier in skkuverse-app/apps/mobile/app.config.ts.
const IOS_BUNDLE_ID = "com.example.skkumap";
const APP_STORE_LOOKUP_URL = `https://itunes.apple.com/lookup?bundleId=${IOS_BUNDLE_ID}&country=kr`;
const DEFAULT_CONFIG_URL = "https://api.skkuverse.com/app/config";

function configUrl(argv) {
  const at = argv.indexOf("--url");
  if (at === -1) return DEFAULT_CONFIG_URL;
  const url = argv[at + 1];
  if (!url) throw new Error("--url needs a value");
  return url;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function main() {
  const url = configUrl(process.argv.slice(2));
  const [lookup, config] = await Promise.all([getJson(APP_STORE_LOOKUP_URL), getJson(url)]);
  const store = lookup.results?.[0];
  const { ios, android } = config.data ?? {};

  console.log(`App Store (${IOS_BUNDLE_ID}, kr): version ${store?.version}, minimumOsVersion ${store?.minimumOsVersion}`);
  console.log(`Served ios (${url}): minVersion ${ios?.minVersion}, minOsVersion ${ios?.minOsVersion}`);
  console.log(`Served android: minVersion ${android?.minVersion}, minOsVersion ${android?.minOsVersion}`);
  console.log("  Android: no public Play API. Check in Play Console that the live release is at least minVersion,");
  console.log("  rolled out to 100%, and that its minSdk equals minOsVersion.");

  const problems = iosGateProblems(store, ios);
  if (!android?.minVersion || !android?.minOsVersion) problems.push("served android.minVersion or android.minOsVersion is missing");
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL: ${problem}`);
    process.exit(1);
  }
  console.log("OK: the iOS gate matches the App Store listing.");
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
