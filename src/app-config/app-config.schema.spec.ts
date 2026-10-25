/**
 * appPlatformGatesDataset, the shape of the `app-platform-gates` dataset: one platform gate per platform,
 * `ios` and `android`, each a `minVersion`, an `updateUrl` and a `minOsVersion`. A push is refused on it and
 * the read parses with it, so a gate the app cannot compare is never served.
 *
 * The captured gates (the fixture) pass, and parse into the key order installed apps were served
 * (`minVersion`, `updateUrl`, `minOsVersion`) whatever order they were stored in. A copy missing any field
 * fails at its path; `minVersion` is a three-part version, `updateUrl` an https URL, and `minOsVersion` an
 * iOS version (one to three dot-separated numbers) or an Android API level (digits), the shapes the app's
 * force-update gate parses (skkuverse-app/packages/shared/src/schema/app-config.schema.ts). A key the
 * dataset does not hold is refused. storedAppPlatformGates, the stored document as the repository reads it,
 * needs its revision and data.
 */
import { appPlatformGatesFixture } from "../../__tests__/helpers/app-config/app-platform-gates";
import { appPlatformGatesDataset, storedAppPlatformGates } from "./app-config.schema";

function withGateField(platform: "ios" | "android", field: string, value: unknown): Record<string, unknown> {
  const data = appPlatformGatesFixture() as unknown as Record<string, Record<string, unknown>>;
  if (value === undefined) delete data[platform]![field];
  else data[platform]![field] = value;
  return data;
}

function pathsOf(raw: unknown): string[] {
  const result = appPlatformGatesDataset.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("appPlatformGatesDataset", () => {
  it("passes the production gates as they are", () => {
    // Act
    const parsed = appPlatformGatesDataset.parse(appPlatformGatesFixture());

    // Assert
    expect(parsed).toEqual({
      ios: { minVersion: "3.5.0", updateUrl: "https://apps.apple.com/app/id6446813434", minOsVersion: "16.4" },
      android: { minVersion: "3.5.0", updateUrl: "https://play.google.com/store/apps/details?id=com.zoyoong.skkubus", minOsVersion: "24" },
    });
  });

  it("parses each gate into the served key order, whatever order it was stored in", () => {
    // Arrange
    const { ios, android } = appPlatformGatesFixture();
    const reordered = {
      android: { minOsVersion: android.minOsVersion, updateUrl: android.updateUrl, minVersion: android.minVersion },
      ios: { minOsVersion: ios.minOsVersion, minVersion: ios.minVersion, updateUrl: ios.updateUrl },
    };

    // Act
    const parsed = appPlatformGatesDataset.parse(reordered);

    // Assert
    expect(Object.keys(parsed.ios)).toEqual(["minVersion", "updateUrl", "minOsVersion"]);
    expect(Object.keys(parsed.android)).toEqual(["minVersion", "updateUrl", "minOsVersion"]);
  });

  it.each(["ios", "android"] as const)("fails a copy without %s", (platform) => {
    // Arrange
    const data = appPlatformGatesFixture() as unknown as Record<string, unknown>;
    delete data[platform];

    // Act & Assert
    expect(pathsOf(data)).toEqual([platform]);
  });

  it.each([
    ["ios", "minVersion"],
    ["ios", "updateUrl"],
    ["ios", "minOsVersion"],
    ["android", "minVersion"],
    ["android", "updateUrl"],
    ["android", "minOsVersion"],
  ] as const)("fails a copy whose %s gate has no %s, naming it", (platform, field) => {
    // Act & Assert
    expect(pathsOf(withGateField(platform, field, undefined))).toEqual([`${platform}.${field}`]);
  });

  it.each(["3.6.2", "10.0.0", "3.10.12"])("passes the minVersion %j", (minVersion) => {
    // Act & Assert
    expect(pathsOf(withGateField("ios", "minVersion", minVersion))).toEqual([]);
  });

  it.each(["3.6", "3", "v3.6.2", "3.6.2-beta", "3.6.2 ", "", "3.6.x", null, 362])("fails the minVersion %j", (minVersion) => {
    // Act & Assert
    expect(pathsOf(withGateField("android", "minVersion", minVersion))).toEqual(["android.minVersion"]);
  });

  it.each(["16", "16.4", "16.4.1", "15.1"])("passes the iOS minOsVersion %j", (minOsVersion) => {
    // Act & Assert
    expect(pathsOf(withGateField("ios", "minOsVersion", minOsVersion))).toEqual([]);
  });

  it.each(["16.4.1.0", "v16.4", "16.", ".4", "16,4", "16.4 ", "iOS 16.4", "sixteen", 16.4])("fails the iOS minOsVersion %j", (minOsVersion) => {
    // Act & Assert
    expect(pathsOf(withGateField("ios", "minOsVersion", minOsVersion))).toEqual(["ios.minOsVersion"]);
  });

  it.each(["24", "21", "35"])("passes the Android minOsVersion %j", (minOsVersion) => {
    // Act & Assert
    expect(pathsOf(withGateField("android", "minOsVersion", minOsVersion))).toEqual([]);
  });

  it.each(["7.0", "API 24", "24 ", "-24", "android24", "16.4", 24])("fails the Android minOsVersion %j", (minOsVersion) => {
    // Act & Assert
    expect(pathsOf(withGateField("android", "minOsVersion", minOsVersion))).toEqual(["android.minOsVersion"]);
  });

  it.each(["http://apps.apple.com/app/id6446813434", "apps.apple.com/app/id6446813434", "", null])("fails the updateUrl %j", (updateUrl) => {
    // Act & Assert
    expect(pathsOf(withGateField("ios", "updateUrl", updateUrl))).toEqual(["ios.updateUrl"]);
  });

  it("fails a key a gate does not hold, naming its gate", () => {
    // Act & Assert
    expect(pathsOf(withGateField("ios", "minVerison", "3.6.2"))).toEqual(["ios"]);
  });

  it("fails a platform the dataset does not hold", () => {
    // Arrange
    const data = { ...appPlatformGatesFixture(), web: appPlatformGatesFixture().ios };

    // Act & Assert
    expect(pathsOf(data)).toEqual([""]);
  });
});

describe("storedAppPlatformGates", () => {
  it("passes a stored document's revision and data", () => {
    // Act
    const parsed = storedAppPlatformGates.parse({ revision: 3, data: appPlatformGatesFixture() });

    // Assert
    expect(parsed).toEqual({ revision: 3, data: appPlatformGatesFixture() });
  });

  it.each([["revision"], ["data"]])("fails a document without %s", (field) => {
    // Arrange
    const doc: Record<string, unknown> = { revision: 3, data: appPlatformGatesFixture() };
    delete doc[field];

    // Act
    const result = storedAppPlatformGates.safeParse(doc);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path)).toEqual([[field]]);
  });
});
