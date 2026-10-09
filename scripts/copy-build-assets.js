// tsc only emits .js (from .ts) and copies-through .js files. JSON assets
// that are require()'d or fs.readFileSync'd at runtime must be staged into
// dist/ separately. List every such asset here.
const fs = require("fs");
const path = require("path");

const assets = [
  // notices/tabConfig + notices/sources read these with fs.readFileSync(__dirname/<name>)
  ["src/notices/categories.json", "dist/src/notices/categories.json"],
  ["src/notices/sources.json", "dist/src/notices/sources.json"],
  ["src/notices/exclude-reasons.json", "dist/src/notices/exclude-reasons.json"],
  // holiday-calendar reads this with fs.readFileSync(__dirname/<name>)
  ["src/bus/schedule/skku-rest-days.json", "dist/src/bus/schedule/skku-rest-days.json"],
  // schedule-stops.ts reads this with fs.readFileSync(__dirname/<name>); a miss
  // exits the api at boot in production only
  ["src/bus/schedule/schedule-stops.json", "dist/src/bus/schedule/schedule-stops.json"],
  // jongro.registry reads this with fs.readFileSync(__dirname/<name>)
  ["src/bus/registry/jongro-routes.json", "dist/src/bus/registry/jongro-routes.json"],
  // miniapps/miniapps.ts reads these with fs.readFileSync(__dirname/<name>).
  // Every details/<id>.json listed in index.json must appear here too — the
  // loader reads them eagerly at boot, so a missing file is a startup crash.
  ["src/miniapps/index.json", "dist/src/miniapps/index.json"],
  [
    "src/miniapps/details/eskara-2026.json",
    "dist/src/miniapps/details/eskara-2026.json",
  ],
  ["src/miniapps/details/hssc.json", "dist/src/miniapps/details/hssc.json"],
  ["src/miniapps/details/inja.json", "dist/src/miniapps/details/inja.json"],
  ["src/miniapps/details/mukja.json", "dist/src/miniapps/details/mukja.json"],
  ["src/miniapps/details/playlist.json", "dist/src/miniapps/details/playlist.json"],
  ["src/miniapps/details/booth-box.json", "dist/src/miniapps/details/booth-box.json"],
  ["src/miniapps/details/timetable.json", "dist/src/miniapps/details/timetable.json"],
  ["src/miniapps/details/nsc.json", "dist/src/miniapps/details/nsc.json"],
  ["src/miniapps/details/skkuw.json", "dist/src/miniapps/details/skkuw.json"],
  ["src/miniapps/details/skkuzine.json", "dist/src/miniapps/details/skkuzine.json"],
  // ui/home/home-layout.ts reads this with fs.readFileSync(__dirname/<name>)
  ["src/ui/home/home-layout.json", "dist/src/ui/home/home-layout.json"],
  // ui/ui/ui.campus.ts reads this with fs.readFileSync(__dirname/<name>)
  ["src/ui/ui/campus-banners.json", "dist/src/ui/ui/campus-banners.json"],
  // eventmap/eventmap.config.ts reads these with fs.readFileSync(__dirname/config/<name>).
  // Every entry in that module's CONFIG_FILES must appear here — it lists files
  // explicitly rather than readdir'ing precisely so a miss shows up as a named
  // ENOENT in the logs instead of a silently absent event map.
  [
    "src/map/config/eskara-2026.json",
    "dist/src/map/config/eskara-2026.json",
  ],
];

for (const [src, dest] of assets) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest);
  process.stdout.write(`  copied ${src} → ${dest}\n`);
}

// tsc emits __tests__/helpers compiled output because they're in tsconfig.include
// (needed for typecheck). Strip from dist/ so Docker COPY doesn't ship them.
fs.rmSync("dist/__tests__", { recursive: true, force: true });
process.stdout.write("  stripped dist/__tests__\n");

// Unit tests live next to their sources as src/**/*.spec.ts and tsconfig.json
// excludes them. A compiled spec in dist/ means that exclude was lost, and the
// image would ship test code (and its jest.mock calls) to production.
const specs = fs
  .readdirSync("dist", { recursive: true, encoding: "utf8" })
  .filter((f) => /\.spec\.js$/.test(f));
if (specs.length > 0) {
  process.stderr.write(
    `  dist/ contains compiled specs (check the exclude in tsconfig.json):\n${specs
      .map((f) => `    dist/${f}\n`)
      .join("")}`,
  );
  process.exit(1);
}
