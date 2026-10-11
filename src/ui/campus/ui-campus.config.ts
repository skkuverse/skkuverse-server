import fs from "fs";
import path from "path";
import { isBrokenLinkAction, parseConfigFile } from "../ui.schema";
import type { MiniAppRegistry } from "../ui.types";
import { campusBannersFile, type CampusBannerCarouselRaw } from "./ui-campus.schema";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const CAMPUS_BANNERS_FILE = path.join(__dirname, "campus-banners.json");

export function loadCampusBanners(raw: unknown, registry: MiniAppRegistry): Readonly<CampusBannerCarouselRaw> {
  const schema = campusBannersFile.superRefine((carousel, ctx) => {
    for (const image of carousel.items.filter((item) => isBrokenLinkAction(item, registry))) {
      const message = `"${image.id}" actionValue "${image.actionValue}" is not valid for "${image.actionType}"`;
      ctx.addIssue({ code: "custom", message });
    }
  });
  return Object.freeze(parseConfigFile("campus banners", schema, raw));
}

export function readCampusBanners(registry: MiniAppRegistry): Readonly<CampusBannerCarouselRaw> {
  return loadCampusBanners(JSON.parse(fs.readFileSync(CAMPUS_BANNERS_FILE, "utf8")), registry);
}
