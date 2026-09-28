import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import axios from "axios";
import moment from "moment-timezone";
import logger from "../../infra/logger";
import type {
  JongroListItem,
  JongroListResponse,
  JongroLocResponse,
  JongroStationMapping,
} from "../types";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { BusCacheService } from "../cache/bus-cache.service";
import { JONGRO_ROUTES } from "../registry/jongro-registry.provider";
import type { JongroRoute } from "../registry/jongro-registry";

export interface JongroListEntry {
  stationId: string;
  sequence: string;
  stationName: string;
  carNumber: string;
  eventDate: string;
  stationNumber: string;
  eta: string;
}

export interface JongroLocEntry {
  sequence: string;
  stationName: string;
  carNumber: string;
  eventDate: string;
  estimatedTime: number;
  stationId: string;
  latitude: string;
  longitude: string;
  recordTime: string;
}

const STALE_MINUTES = 10;

// "0" = success, "4" = no-result (overnight). Other codes are upstream errors.
function isUsableHeaderCd(cd: string | undefined): boolean {
  return cd === "0" || cd === "4";
}

/**
 * Jongro shuttle poller — exact port of features/bus/jongro.fetcher.ts.
 *
 * Per-route in-mem state held on the singleton. Iterates the validated
 * JONGRO_ROUTES registry. Single 40s poller tick polls list + loc for every
 * registered route. Cache keys `jongro_locations_<code>` /
 * `jongro_stations_<code>` preserved byte-identical via registry `code`.
 */
@Injectable()
export class JongroPollerService implements OnModuleInit {
  // Lazily initialized per route code — getJongroBusList("07") returns
  // undefined until the first successful fetch for that route.
  private filteredBusStations: Record<string, JongroListEntry[]> = {};
  private filteredBusLocations: Record<string, JongroLocEntry[]> = {};
  private busStationTimes: Record<string, Record<string, string>> = {};
  // Route codes whose registry drift has already been logged by this process.
  private driftWarned = new Set<string>();

  private readonly mappingByCode: Record<
    string,
    Readonly<JongroStationMapping>
  >;

  constructor(
    private readonly registry: PollerRegistryService,
    private readonly cache: BusCacheService,
    @Inject(JONGRO_ROUTES)
    private readonly jongroRoutes: ReadonlyArray<JongroRoute>,
  ) {
    // Derived from the registry once. `code` ("02","07",…) stays the cache-key
    // suffix to preserve byte-identical bus_cache document IDs.
    this.mappingByCode = Object.fromEntries(
      this.jongroRoutes.map((r) => [r.code, r.mapping]),
    );
  }

  onModuleInit(): void {
    this.registry.registerPoller(
      () => {
        for (const route of this.jongroRoutes) {
          this.updateJongroBusList(route.listUrl, route.code).catch(
            (err: unknown) =>
              logger.error(
                {
                  err: err instanceof Error ? err.message : String(err),
                  code: route.code,
                },
                "[jongro] Poller error (list)",
              ),
          );
          this.updateJongroBusLocation(route.locUrl, route.code).catch(
            (err: unknown) =>
              logger.error(
                {
                  err: err instanceof Error ? err.message : String(err),
                  code: route.code,
                },
                "[jongro] Poller error (location)",
              ),
          );
        }
      },
      40000,
      "jongro",
    );
  }

  private async updateJongroBusLocation(
    url: string,
    code: string,
  ): Promise<void> {
    try {
      const response = await axios.get<JongroLocResponse>(url, {
        timeout: 10000,
      });
      const env = response.data;
      const cd = env?.msgHeader?.headerCd;
      if (cd && !isUsableHeaderCd(cd)) {
        logger.warn(
          { headerCd: cd, headerMsg: env.msgHeader?.headerMsg, code },
          "[jongro] Upstream error code (location)",
        );
        return;
      }
      const apiData = env?.msgBody?.itemList;
      if (!apiData) return; // null at overnight "4" / missing envelope

      const currentTime = moment().tz("Asia/Seoul").toDate();
      let currentBusStationTimes = this.busStationTimes[code];
      if (!currentBusStationTimes) {
        currentBusStationTimes = {};
        this.busStationTimes[code] = currentBusStationTimes;
      }

      const mapping = this.mappingByCode[code];
      if (!mapping) {
        // Surface an unregistered code explicitly instead of letting `!` turn
        // into undefined.<lastStnId> swallowed by the outer try/catch.
        logger.warn({ code }, "[jongro] Unknown route code — not in registry");
        return;
      }
      this.filteredBusLocations[code] = apiData
        .map((item): JongroLocEntry | null => {
          const { lastStnId, tmX, tmY, plainNo } = item;
          const stationInfo = mapping[lastStnId];
          if (!stationInfo) {
            logger.debug({ lastStnId, code }, "[jongro] Unmapped station ID");
            return null;
          }

          let estimatedTime = 0;
          const lastRecorded = currentBusStationTimes![lastStnId];

          if (
            lastRecorded &&
            (currentTime.valueOf() - new Date(lastRecorded).valueOf()) /
              1000 /
              60 >
              STALE_MINUTES
          ) {
            delete currentBusStationTimes![lastStnId];
          }

          const stillRecorded = currentBusStationTimes![lastStnId];
          if (stillRecorded) {
            const lastRecordTime = new Date(stillRecorded);
            estimatedTime = Math.round(
              (currentTime.valueOf() - lastRecordTime.valueOf()) / 1000,
            );
          } else {
            currentBusStationTimes![lastStnId] = currentTime.toISOString();
          }

          const recordTime = currentBusStationTimes![lastStnId]!;

          return {
            sequence: stationInfo.sequence.toString(),
            stationName: stationInfo.stationName,
            carNumber: (plainNo || "").trim().slice(-4) || "----",
            eventDate: recordTime,
            estimatedTime,

            stationId: lastStnId,
            latitude: tmY,
            longitude: tmX,
            recordTime,
          };
        })
        .filter((x): x is JongroLocEntry => x !== null);

      this.cache
        .write(`jongro_locations_${code}`, this.filteredBusLocations[code])
        .catch((err: unknown) =>
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "[jongro] Failed to write bus_cache (locations)",
          ),
        );
    } catch (error: unknown) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "[jongro] Failed to update bus location",
      );
    }
  }

  private async updateJongroBusList(url: string, code: string): Promise<void> {
    try {
      const response = await axios.get<JongroListResponse>(url, {
        timeout: 10000,
      });
      const env = response.data;
      const cd = env?.msgHeader?.headerCd;
      if (cd && !isUsableHeaderCd(cd)) {
        logger.warn(
          { headerCd: cd, headerMsg: env.msgHeader?.headerMsg, code },
          "[jongro] Upstream error code (list)",
        );
        return;
      }
      const apiData = env?.msgBody?.itemList;
      if (!apiData) return;

      this.warnOnRegistryDrift(code, apiData);

      this.filteredBusStations[code] = apiData.map(
        (item): JongroListEntry => {
          const { stId, staOrd, stNm, plainNo1, mkTm, arsId, arrmsg1 } = item;
          return {
            stationId: stId,
            sequence: staOrd,
            stationName: stNm,
            carNumber: (plainNo1 || "").trim().slice(-4) || "----",
            eventDate: mkTm,
            stationNumber: arsId,
            eta: arrmsg1,
          };
        },
      );
      this.cache
        .write(`jongro_stations_${code}`, this.filteredBusStations[code])
        .catch((err: unknown) =>
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "[jongro] Failed to write bus_cache (stations)",
          ),
        );
    } catch (error: unknown) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "[jongro] Failed to update bus list",
      );
    }
  }

  // getArrInfoByRouteAll lists every stop on the route on every tick, so it
  // doubles as a free check that `jongro-routes.json` still matches TOPIS.
  // When TOPIS adds, drops or renumbers stops, buses and ETAs at the unmapped
  // stops silently vanish. This makes that show up in the logs rather than in
  // a user report. It compares ID sets, not counts: a loop route may list its
  // first stop again as the last ord (02 does). Warns once per route per
  // process; renames are harmless because ETAs match by ID.
  private warnOnRegistryDrift(
    code: string,
    apiData: ReadonlyArray<JongroListItem>,
  ): void {
    if (this.driftWarned.has(code)) return;
    const mapping = this.mappingByCode[code];
    if (!mapping) return;
    const topisIds = new Set(apiData.map((item) => item.stId));
    const unmapped = apiData
      .filter((item) => !mapping[item.stId])
      .map((item) => ({ stId: item.stId, stNm: item.stNm, staOrd: item.staOrd }));
    const missing = Object.entries(mapping)
      .filter(([topisId]) => !topisIds.has(topisId))
      .map(([topisId, s]) => ({ topisId, stationName: s.stationName }));
    if (unmapped.length === 0 && missing.length === 0) return;
    this.driftWarned.add(code);
    logger.warn(
      { code, unmapped, missing },
      "[jongro] jongro-routes.json has drifted from TOPIS — resync the registry",
    );
  }

  getJongroBusList(code: string): JongroListEntry[] | undefined {
    return this.filteredBusStations[code];
  }

  getJongroBusLocation(code: string): JongroLocEntry[] | undefined {
    return this.filteredBusLocations[code];
  }
}
