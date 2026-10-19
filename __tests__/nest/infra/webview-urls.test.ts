/**
 * Every webview URL this API emits, checked for host and form.
 *
 * Nothing else pins what these URLs contain: `ui.routes.test.ts` asserts only
 * that `actionValue` exists, and the bus-config tests compare ETags computed
 * from the same data, so they move with a change rather than catching it.
 *
 * The web view routes by path (skkuverse#46). A `#/` URL served to a
 * BrowserRouter is not an error: the fragment never reaches the origin, the
 * SPA fallback answers the bare path with the shell at HTTP 200, and the app's
 * webview only raises its error overlay above status 400. The user gets the
 * wrong page and no way back, and nothing anywhere reports a failure. There is
 * no signal after deploy, so the signal has to be here.
 *
 * The walk is deliberately shape-blind. It finds URLs by looking for the host
 * rather than by reading known field names, so a new webview link added to any
 * of these payloads is covered without this file being updated.
 */
import type { Clock } from "../../../src/infra/clock";
import { MiniappsService } from "../../../src/miniapps/miniapps.service";
import type { UiCampusRepository } from "../../../src/ui/campus/ui-campus.repository";
import { UiCampusService } from "../../../src/ui/campus/ui-campus.service";
import fs from "fs";
import path from "path";
import { UiScrollService } from "../../../src/ui/scroll/ui-scroll.service";
import { BusConfigService } from "../../../src/bus/config/bus-config.service";
import { storedBusRegistryService } from "../../helpers/bus/bus-registry";
import { BusStopsService } from "../../../src/bus/stops/bus-stops.service";
import { SubwayStationsService } from "../../../src/subway/stations/subway-stations.service";
import { BRIDGE_ORIGINS, WEBVIEW_ORIGIN } from "../../../src/infra/origins";
import { asReal } from "../../helpers/fakes/public-of";
import { FakeUiCampusRepository } from "../../helpers/fakes/ui/ui-campus.repository.fake";


/** Every string anywhere in `value` that names a webview host. */
function webviewUrlsIn(value: unknown): string[] {
  if (typeof value === "string") {
    return value.includes("webview.") ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap(webviewUrlsIn);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(webviewUrlsIn);
  }
  return [];
}

/**
 * The mini-app registry is walked too: it is the one place a webview URL would
 * be hand-typed rather than built from WEBVIEW_ORIGIN.
 *
 * Safe to fold in whole: `webviewUrlsIn` filters on the string `webview.`, and
 * the four third-party entries (`student.skku.edu`, `www.skkuw.com`,
 * `webzine.skku.edu`) do not match it. Their URLs answer to their own hosts'
 * rules, not to the assertions below.
 */
const registryDetails = Object.fromEntries(
  fs
    .readdirSync(path.join(__dirname, "../../../src/miniapps/details"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => [
      f,
      JSON.parse(
        fs.readFileSync(path.join(__dirname, "../../../src/miniapps/details", f), "utf8"),
      ) as unknown,
    ]),
);

// After the festival's campus banners closed (10/3), as on the day this test was pinned.
const clock: Clock = { now: () => new Date("2026-10-13T03:00:00.000Z") };

/** The campus banners as stored: revision 1 of the dataset, which holds what campus-banners.json held. */
function storedCampusBanners(): UiCampusRepository {
  const banners = JSON.parse(fs.readFileSync(path.join(__dirname, "../ui/fixtures/campus-banners.dataset.json"), "utf8")) as Record<string, unknown>;
  delete banners._about;
  const repository = new FakeUiCampusRepository();
  repository.storeCampusBanners(banners);
  return asReal<UiCampusRepository>(repository);
}

// WHY: read when the tests run, since the bus config reads its stations from a registry holding the routes stored on 2026-10-17.
const payloads: Record<string, () => unknown> = {
  "GET /ui/home/campus": () => new UiCampusService(storedCampusBanners(), new MiniappsService(), clock).getCampusSheet("ko"),
  "GET /ui/home/scroll": () => new UiScrollService().listScrollCards("ko"),
  "GET /bus/config": async () => new BusConfigService(new BusStopsService(new SubwayStationsService()), storedBusRegistryService()).getBusGroups(),
  "src/miniapps/details/*.json": () => registryDetails,
};

describe("webview URLs the API hands out", () => {
  it("emits at least one, so an empty walk cannot pass by accident", async () => {
    // Act
    const all = (await Promise.all(Object.values(payloads).map((read) => read()))).flatMap(webviewUrlsIn);

    // Assert
    expect(all.length).toBeGreaterThan(0);
  });

  for (const [name, read] of Object.entries(payloads)) {
    describe(name, () => {
      let urls: string[] = [];

      beforeAll(async () => {
        urls = webviewUrlsIn(await read());
      });

      it("builds every webview URL from WEBVIEW_ORIGIN", () => {
        // Assert
        for (const url of urls) {
          expect(url.startsWith(`${WEBVIEW_ORIGIN}/`)).toBe(true);
        }
      });

      it("uses path form, never a fragment", () => {
        // Assert
        for (const url of urls) {
          expect(url).not.toContain("#");
        }
      });

      it("names a host that is granted the bridge", () => {
        // Assert
        // A URL for a host outside the allowlist loads with a dead bridge:
        // the client fails closed and neither side logs anything.
        for (const url of urls) {
          expect(BRIDGE_ORIGINS).toContain(new URL(url).origin);
        }
      });
    });
  }
});
