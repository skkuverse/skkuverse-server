import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { isBrokenLinkAction } from "../ui.rules";
import type { MiniAppRegistry } from "../ui.types";
import { campusBannersFile, type CampusBannerCarouselRaw } from "./ui-campus.schema";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const CAMPUS_BANNERS_FILE = path.join(__dirname, "campus-banners.json");

export function loadCampusBanners(raw: unknown, registry: MiniAppRegistry): Readonly<CampusBannerCarouselRaw> {
  const schema = campusBannersFile.superRefine((carousel, ctx) => {
    carousel.items.forEach((image, i) => {
      if (!isBrokenLinkAction(image, registry)) return;
      const message = `"${image.id}" actionValue "${image.actionValue}" is not valid for "${image.actionType}"`;
      ctx.addIssue({ code: "custom", path: ["items", i, "actionValue"], message });
    });
  });
  return Object.freeze(parseConfigFile("campus banners", schema, raw));
}

export function readCampusBanners(registry: MiniAppRegistry): Readonly<CampusBannerCarouselRaw> {
  return loadCampusBanners(JSON.parse(fs.readFileSync(CAMPUS_BANNERS_FILE, "utf8")), registry);
}
