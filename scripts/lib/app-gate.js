"use strict";

/**
 * Pure checks for `npm run app-gate:check`: the App Store's live listing against
 * what /app/config serves for iOS. Kept apart from the CLI so jest can require it
 * without argv, network or process.exit. Requiring this file has no side effects.
 */

/** Compares dot-separated numeric versions ("3.6.2", "16.4"); a missing part counts as 0. */
function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

const isVersion = (value) => typeof value === "string" && /^\d+(\.\d+)*$/.test(value);

/**
 * `store` is the App Store lookup's first result ({ version, minimumOsVersion });
 * `served` is the served `ios` gate ({ minVersion, minOsVersion }).
 * Returns one line per problem; an empty list passes.
 */
function iosGateProblems(store, served) {
  const fields = [
    ["App Store version", store?.version],
    ["App Store minimumOsVersion", store?.minimumOsVersion],
    ["served ios.minVersion", served?.minVersion],
    ["served ios.minOsVersion", served?.minOsVersion],
  ];
  const missing = fields.filter(([, value]) => !isVersion(value)).map(([label, value]) => `${label} is missing or not a version (got ${JSON.stringify(value)})`);
  if (missing.length > 0) return missing;

  const problems = [];
  if (compareVersions(store.version, served.minVersion) < 0) {
    problems.push(`App Store version ${store.version} is below the served ios.minVersion ${served.minVersion}: every gated user would be sent to a store that cannot update them`);
  }
  if (compareVersions(store.minimumOsVersion, served.minOsVersion) !== 0) {
    problems.push(`App Store minimumOsVersion ${store.minimumOsVersion} differs from the served ios.minOsVersion ${served.minOsVersion}`);
  }
  return problems;
}

module.exports = { compareVersions, iosGateProblems };
