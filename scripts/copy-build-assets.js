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
  // miniapps/miniapps.config.ts reads these with fs.readFileSync(__dirname/<name>).
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
  // ui/home/ui-home.config.ts reads this with fs.readFileSync(__dirname/<name>)
  ["src/ui/home/home-layout.json", "dist/src/ui/home/home-layout.json"],
  // ui/campus/ui-campus.config.ts reads this with fs.readFileSync(__dirname/<name>)
  ["src/ui/campus/campus-banners.json", "dist/src/ui/campus/campus-banners.json"],
  // map/layer-set/map-layer-set.config.ts reads these with fs.readFileSync(__dirname/<name>).
  // Every entry in its LAYER_SET_FILES must appear here — it lists files
  // explicitly rather than readdir'ing precisely so a miss shows up as a named
  // ENOENT in the logs instead of a silently absent event map.
  [
    "src/map/layer-set/eskara-2026.json",
    "dist/src/map/layer-set/eskara-2026.json",
  ],
];

for (const [src, dest] of assets) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest);
  process.stdout.write(`  copied ${src} → ${dest}\n`);
}

// tsconfig.build.json compiles src/ only, but tsc never cleans dist/: a
// dist/__tests__ left by an older build would otherwise ship in the image.
fs.rmSync("dist/__tests__", { recursive: true, force: true });
process.stdout.write("  stripped dist/__tests__\n");

// Unit tests live next to their sources as src/**/*.spec.ts and
// tsconfig.build.json excludes them. A compiled spec in dist/ means that
// exclude was lost, and the image would ship test code (and its jest.mock
// calls) to production.
const specs = fs
  .readdirSync("dist", { recursive: true, encoding: "utf8" })
  .filter((f) => /\.spec\.js$/.test(f));
if (specs.length > 0) {
  process.stderr.write(
    `  dist/ contains compiled specs (check the exclude in tsconfig.build.json):\n${specs
      .map((f) => `    dist/${f}\n`)
      .join("")}`,
  );
  process.exit(1);
}
