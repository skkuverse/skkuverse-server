import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { KeyedCache } from "../../infra/keyed-cache";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { parseEach } from "../../shared/zod-list.util";
import { MAX_CACHED_MENU_DATES, MENU_CACHE_TTL_MS } from "./meals-menus.constants";
import type { MenuDoc } from "./meals-menus.document";
import { toMenuIds } from "./meals-menus.rules";
import { menuDoc } from "./meals-menus.schema";

const MENU_FIELDS = { _id: 1, cafeteriaId: 1, date: 1, meal: 1, cells: 1 } as const;

// WHY: by `_id`, the crawler's key, so the read needs no index of a collection this server does not own.
@Injectable()
export class MealsMenusRepository {
  private readonly menusCache = new KeyedCache<MenuDoc[]>(MENU_CACHE_TTL_MS, MAX_CACHED_MENU_DATES, "meals.menus");

  async listMenus(cafeteriaIds: readonly string[], date: string): Promise<MenuDoc[]> {
    const { value } = await this.menusCache.get(`${date}:${cafeteriaIds.join(",")}`, () => this.readMenus(cafeteriaIds, date));
    return value;
  }

  private async readMenus(cafeteriaIds: readonly string[], date: string): Promise<MenuDoc[]> {
    const docs = await this.menus()
      .find({ _id: { $in: toMenuIds(cafeteriaIds, date) } }, { projection: MENU_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .toArray();
    const { valid, invalid } = parseEach(docs, menuDoc, (doc, index) => this.keyOf(doc, index));
    if (invalid.length > 0) {
      logger.error({ event: "meals.menus.invalid_document", invalid }, "Menu documents left out: not the shape the crawler writes");
    }
    return valid;
  }

  private keyOf(doc: unknown, index: number): string {
    return typeof doc === "object" && doc !== null && "_id" in doc ? String(doc._id) : `#${index}`;
  }

  private menus(): Collection<MenuDoc> {
    return mongoCollection<MenuDoc>(config.meals.dbName, config.meals.collections.menus);
  }
}
