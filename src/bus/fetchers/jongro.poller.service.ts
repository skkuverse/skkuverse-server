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
import { UpstreamError } from "./upstream-error";
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
 * Jongro shuttle poller.
 *
 * Per-route in-mem state held on the singleton. Iterates the validated
 * JONGRO_ROUTES registry. Single 40s poller tick polls list + loc for every
 * registered route. Cache keys are `jongro_locations_<code>` /
 * `jongro_stations_<code>` from the registry `code`; RealtimeController reads
 * them back by the same `code`.
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
  private readonly routeByCode: Record<string, JongroRoute>;

  constructor(
    private readonly registry: PollerRegistryService,
    private readonly cache: BusCacheService,
    @Inject(JONGRO_ROUTES)
    private readonly jongroRoutes: ReadonlyArray<JongroRoute>,
  ) {
    // Derived from the registry once. `code` ("02","07",…) is the cache-key
    // suffix of the bus_cache document IDs.
    this.mappingByCode = Object.fromEntries(
      this.jongroRoutes.map((r) => [r.code, r.mapping]),
    );
    this.routeByCode = Object.fromEntries(
      this.jongroRoutes.map((r) => [r.code, r]),
    );
  }

  onModuleInit(): void {
    // One poller per route, so one dead route does not mark the others down.
    // The registry logs failures as state transitions; see its header.
    for (const route of this.jongroRoutes) {
      this.registry.registerPoller(
        () =>
          Promise.all([
            this.updateJongroBusList(route.listUrl, route.code),
            this.updateJongroBusLocation(route.locUrl, route.code),
          ]),
        40000,
        `jongro-${route.code}`,
      );
    }
  }

  private async updateJongroBusLocation(
    url: string,
    code: string,
  ): Promise<void> {
    const response = await axios.get<JongroLocResponse>(url, {
      timeout: 10000,
    });
    const env = response.data;
    const cd = env?.msgHeader?.headerCd;
    if (cd && !isUsableHeaderCd(cd)) {
      throw new UpstreamError(
        `TOPIS error code (jongro ${code} location)`,
        "topis",
        cd,
        env.msgHeader?.headerMsg,
      );
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
      // Explicit, instead of letting `!` turn into undefined.<lastStnId>.
      throw new Error(`Unknown jongro route code ${code} — not in the registry`);
    }
    this.filteredBusLocations[code] = apiData
      .map((item): JongroLocEntry | null => {
        const { lastStnId, tmX, tmY, plainNo } = item;
        const stationInfo = mapping[lastStnId];
        if (!stationInfo) {
          logger.debug(
            { event: "bus.jongro.unmapped_station", lastStnId, code },
            "Unmapped station ID",
          );
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

    // api replicas read bus_cache, so a failed write is a failed tick.
    await this.cache.write(`jongro_locations_${code}`, this.filteredBusLocations[code]);
  }

  private async updateJongroBusList(url: string, code: string): Promise<void> {
    const response = await axios.get<JongroListResponse>(url, {
      timeout: 10000,
    });
    const env = response.data;
    const cd = env?.msgHeader?.headerCd;
    if (cd && !isUsableHeaderCd(cd)) {
      throw new UpstreamError(
        `TOPIS error code (jongro ${code} list)`,
        "topis",
        cd,
        env.msgHeader?.headerMsg,
      );
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
    // api replicas read bus_cache, so a failed write is a failed tick.
    await this.cache.write(`jongro_stations_${code}`, this.filteredBusStations[code]);
  }

  // getArrInfoByRouteAll lists every stop on the route on every tick, so it
  // doubles as a free check that `jongro-routes.json` still mirrors TOPIS.
  // The registry is TOPIS's stop list verbatim (ord i ⇔ stations[i-1], same
  // name), so the check is exact: a stop whose ID differs at its ord (added,
  // dropped or reordered), a registry ord TOPIS no longer lists, or a rename.
  // When stops move, buses and ETAs land on the wrong stop or vanish, so this
  // puts it in the logs rather than in a user report. Once per route per process.
  private warnOnRegistryDrift(
    code: string,
    apiData: ReadonlyArray<JongroListItem>,
  ): void {
    if (this.driftWarned.has(code)) return;
    const route = this.routeByCode[code];
    if (!route) return;
    const seenOrds = new Set<number>();
    const mismatched: Array<{
      staOrd: string;
      stId: string;
      stNm: string;
      expected: string | null;
    }> = [];
    const renamed: Array<{
      staOrd: string;
      stNm: string;
      registryName: string;
    }> = [];
    for (const item of apiData) {
      const idx = parseInt(item.staOrd, 10) - 1;
      seenOrds.add(idx);
      const expected = route.topisIds[idx];
      if (expected !== item.stId) {
        mismatched.push({
          staOrd: item.staOrd,
          stId: item.stId,
          stNm: item.stNm,
          expected: expected ?? null,
        });
        continue;
      }
      const registryName = route.stations[idx]!.stationName;
      if (registryName !== item.stNm) {
        renamed.push({ staOrd: item.staOrd, stNm: item.stNm, registryName });
      }
    }
    const missing = route.topisIds
      .map((topisId, idx) => ({
        staOrd: String(idx + 1),
        topisId,
        stationName: route.stations[idx]!.stationName,
      }))
      .filter((_, idx) => !seenOrds.has(idx));
    if (mismatched.length === 0 && missing.length === 0 && renamed.length === 0) return;
    this.driftWarned.add(code);
    logger.warn(
      { event: "bus.jongro.registry_drift", code, mismatched, missing, renamed },
      "jongro-routes.json has drifted from TOPIS — resync the registry",
    );
  }

  getJongroBusList(code: string): JongroListEntry[] | undefined {
    return this.filteredBusStations[code];
  }

  getJongroBusLocation(code: string): JongroLocEntry[] | undefined {
    return this.filteredBusLocations[code];
  }
}
