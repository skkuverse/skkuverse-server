/**
 * In-memory MealsMenusRepository over `meals`, with the real read's filter
 * (`_id` in every cafeteria × meal code of the date), projection and parse,
 * pinned in meals-menus.repository.spec.ts: a document the schema rejects is
 * left out. `documents` holds what the crawler wrote, unparsed; `failWith`
 * makes the read reject, as a database error would.
 */
import type { MenuDoc } from "../../../../src/meals/menus/meals-menus.document";
import type { MealsMenusRepository } from "../../../../src/meals/menus/meals-menus.repository";
import { toMenuIds } from "../../../../src/meals/menus/meals-menus.rules";
import { menuDoc } from "../../../../src/meals/menus/meals-menus.schema";
import type { PublicOf } from "../public-of";

const MENU_FIELDS = ["_id", "cafeteriaId", "date", "meal", "cells"] as const;

export class FakeMealsMenusRepository implements PublicOf<MealsMenusRepository> {
  documents: Array<Record<string, unknown>> = [];
  failWith: Error | null = null;

  async listMenus(cafeteriaIds: readonly string[], date: string): Promise<MenuDoc[]> {
    if (this.failWith) throw this.failWith;
    const ids = new Set(toMenuIds(cafeteriaIds, date));
    return this.documents
      .filter((doc) => ids.has(String(doc._id)))
      .map((doc) => Object.fromEntries(MENU_FIELDS.filter((field) => field in doc).map((field) => [field, doc[field]])))
      .flatMap((doc) => {
        const parsed = menuDoc.safeParse(doc);
        return parsed.success ? [parsed.data] : [];
      });
  }
}
