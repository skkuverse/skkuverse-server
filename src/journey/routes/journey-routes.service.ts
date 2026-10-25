import { Injectable } from "@nestjs/common";
import { withMeta } from "../../http/response.interceptor";
import type { WithMeta } from "../../http/response.types";
import { createCachedLoader, type CachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import type { DepartureBoard } from "../../shared/departure.types";
import { toKstInstant } from "../../shared/kst-date.util";
import type { Place } from "../../shared/place.wire";
import { JourneyDeparturesService } from "../departures/journey-departures.service";
import { JOURNEY_LOG_INTERVAL_MS } from "../journey.constants";
import type { JourneyLine, JourneyOption, JourneyRoute, RideLeg, StoredJourneyRoutes } from "../journey.document";
import { JourneyRoutesReadError, JourneyRoutesUnavailableError } from "../journey.error";
import { JourneyRepository } from "../journey.repository";
import { toPlaceRef } from "../journey.rules";
import { JourneyPlacesService } from "../places/journey-places.service";
import { PLAN_CACHE_TTL_MS, PLAN_HORIZON_MS, PLAN_LOG_INTERVAL_MS } from "./journey-routes.constants";
import { toLegPlaces, toPlaceKey, toServedRoute } from "./journey-routes.mapper";
import { planOption, toOptionOrder } from "./journey-routes.rules";
import type { CitedLegPlace, LegBoards, PlannedOption, ServedRoute } from "./journey-routes.types";
import type { JourneyRoutes, JourneyRoutesMeta } from "./journey-routes.wire";

type PlanInput = { data: StoredJourneyRoutes["data"]; now: Date; lang: SupportedLang };

const UNAVAILABLE: PlannedOption = { status: "notRunning", reason: "unavailable", nextServiceAt: null };

// SEE: docs/explanation/journey-architecture.md ("Structure"): the dataset, the doors and the catalogs, read only, planned per route.
@Injectable()
export class JourneyRoutesService {
  private readonly dataset: DatasetLoader<StoredJourneyRoutes>;
  // WHY: keyed by route id and language, both bounded by the dataset and SUPPORTED_LANGS.
  private readonly plans = new Map<string, CachedLoader<ServedRoute | null>>();
  private readonly failureThrottle = createLogThrottle(PLAN_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(
    repository: JourneyRepository,
    private readonly departures: JourneyDeparturesService,
    private readonly places: JourneyPlacesService,
    private readonly clock: Clock,
  ) {
    this.dataset = createDatasetLoader({
      name: "journey.routes",
      load: () => repository.findRoutes(),
      clock,
      isReadError: (err): err is JourneyRoutesReadError => err instanceof JourneyRoutesReadError,
      toUnavailable: () => new JourneyRoutesUnavailableError(),
      readFailedEvent: "journey.routes_dataset.read_failed",
      logIntervalMs: JOURNEY_LOG_INTERVAL_MS,
    });
  }

  async listRoutes(lang: SupportedLang): Promise<WithMeta<JourneyRoutes, JourneyRoutesMeta>> {
    const { data } = await this.dataset.get();
    const routes = await Promise.all(data.routes.map((route) => this.planOf(route.id, lang)));
    return withMeta({ routes: routes.flatMap((route) => (route ? [route] : [])) }, { serverNow: toKstInstant(this.clock.now().getTime()) });
  }

  private planOf(routeId: string, lang: SupportedLang): Promise<ServedRoute | null> {
    const key = `${routeId}|${lang}`;
    const loader = this.plans.get(key) ?? createCachedLoader({ name: "journey.route_plan", ttlMs: PLAN_CACHE_TTL_MS, load: () => this.planRoute(routeId, lang) });
    this.plans.set(key, loader);
    return loader.get();
  }

  private async planRoute(routeId: string, lang: SupportedLang): Promise<ServedRoute | null> {
    const { data } = await this.dataset.get();
    const route = data.routes.find((candidate) => candidate.id === routeId);
    if (!route) return null;
    const input = { data, now: this.clock.now(), lang };
    const lineById = new Map(data.lines.map((line) => [line.id, line]));
    const [boards, places] = await Promise.all([this.readBoards(route, lineById, input), this.resolvePlaces(route, lang)]);
    const hasEnds = [route.from, route.to].every((ref) => places.has(toPlaceKey({ ref, platformId: null })));
    if (!hasEnds) return null;
    const context = { now: input.now, catchMarginSec: data.catchMarginSec, lineById };
    const planned = route.options.map((option, index) => (this.hasEveryPlace(option, places) ? planOption(option, { ...context, boards: boards[index] ?? new Map() }) : UNAVAILABLE));
    return toServedRoute(route, { planned, order: toOptionOrder(planned) }, { places, lang });
  }

  private hasEveryPlace(option: JourneyOption, places: ReadonlyMap<string, Place>): boolean {
    return option.legs.flatMap(toLegPlaces).every((cited) => places.has(toPlaceKey(cited)));
  }

  // WHY: one door read per distinct line and stop pair, shared by every option of the route that rides it.
  private readBoards(route: JourneyRoute, lineById: ReadonlyMap<string, JourneyLine>, input: PlanInput): Promise<LegBoards[]> {
    const reads = new Map<string, Promise<DepartureBoard | Error>>();
    const boardOf = (leg: RideLeg, line: JourneyLine): Promise<DepartureBoard | Error> => {
      const key = JSON.stringify([line.source, line.sourceLineId, leg.board, leg.alight]);
      const read = reads.get(key) ?? this.readBoard(leg, line, input);
      reads.set(key, read);
      return read;
    };
    return Promise.all(
      route.options.map(async (option) => {
        const entries = option.legs.flatMap((leg, index) => {
          const line = leg.kind === "ride" ? lineById.get(leg.line) : undefined;
          return leg.kind === "ride" && line ? [boardOf(leg, line).then((board) => [index, board] as const)] : [];
        });
        return new Map(await Promise.all(entries));
      }),
    );
  }

  private readBoard(leg: RideLeg, line: JourneyLine, { now, lang }: PlanInput): Promise<DepartureBoard | Error> {
    const stopIdOf = ({ place, platformId }: RideLeg["board"]): string => platformId ?? toPlaceRef(place)?.id ?? place;
    const query = { lineId: line.sourceLineId, boardStopId: stopIdOf(leg.board), alightStopId: stopIdOf(leg.alight), from: now, until: new Date(now.getTime() + PLAN_HORIZON_MS), lang };
    return this.departures.listDepartures(line.source, query).catch((err: unknown) => {
      const ticket = this.failureThrottle.take(`departures:${line.id}`);
      if (ticket) logger.error({ event: "journey.departures.unavailable", lineId: line.id, suppressed: ticket.suppressed, err }, "A journey line's departures could not be read; its options are served as unavailable");
      return err instanceof Error ? err : new Error(String(err));
    });
  }

  // WHY: a place its catalog no longer resolves leaves out what cites it, never the whole response.
  private async resolvePlaces(route: JourneyRoute, lang: SupportedLang): Promise<ReadonlyMap<string, Place>> {
    const cited: CitedLegPlace[] = [route.from, route.to].map((ref) => ({ ref, platformId: null }));
    const all = [...cited, ...route.options.flatMap((option) => option.legs.flatMap(toLegPlaces))];
    const unique = [...new Map(all.map((place) => [toPlaceKey(place), place])).values()];
    const found = await Promise.all(unique.map(async (place) => [toPlaceKey(place), await this.findPlace(place, lang)] as const));
    return new Map(found.flatMap(([key, place]) => (place ? [[key, place] as const] : [])));
  }

  private async findPlace({ ref, platformId }: CitedLegPlace, lang: SupportedLang): Promise<Place | null> {
    try {
      const place = await this.places.findPlace(ref, platformId, lang);
      if (place === null) this.logUnresolved(ref, null);
      return place;
    } catch (err) {
      this.logUnresolved(ref, err);
      return null;
    }
  }

  private logUnresolved(ref: string, err: unknown): void {
    const ticket = this.failureThrottle.take(`place:${ref}`);
    if (ticket) logger.warn({ event: "journey.place.unresolved", ref, suppressed: ticket.suppressed, err }, "A cited place did not resolve; what cites it is served as unavailable");
  }
}
