import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import type { MiniAppRegistry } from "../ui.types";
import { toHomeLayoutIssues } from "./ui-home.rules";
import { homeLayoutFile, type HomeLayoutRaw } from "./ui-home.schema";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const HOME_LAYOUT_FILE = path.join(__dirname, "home-layout.json");

export function loadHomeLayout(raw: unknown, registry: MiniAppRegistry): Readonly<HomeLayoutRaw> {
  const schema = homeLayoutFile.superRefine((layout, ctx) => {
    for (const { path: at, message } of toHomeLayoutIssues(layout, registry)) ctx.addIssue({ code: "custom", path: at, message });
  });
  return Object.freeze(parseConfigFile("home layout", schema, raw));
}

export function readHomeLayout(registry: MiniAppRegistry): Readonly<HomeLayoutRaw> {
  return loadHomeLayout(JSON.parse(fs.readFileSync(HOME_LAYOUT_FILE, "utf8")), registry);
}
