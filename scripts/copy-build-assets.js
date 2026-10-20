// tsc only emits .js (from .ts) and copies-through .js files. JSON assets
// that are require()'d or fs.readFileSync'd at runtime must be staged into
// dist/ separately. List every such asset here.
const fs = require("fs");
const path = require("path");

const assets = [
  // src/notices/notices.config.ts reads these with fs.readFileSync(__dirname/<name>)
  ["src/notices/categories.json", "dist/src/notices/categories.json"],
  ["src/notices/sources.json", "dist/src/notices/sources.json"],
  ["src/notices/exclude-reasons.json", "dist/src/notices/exclude-reasons.json"],
  // src/bus/stops/bus-stops.config.ts reads this with fs.readFileSync(__dirname/<name>)
  ["src/bus/stops/schedule-stops.json", "dist/src/bus/stops/schedule-stops.json"],
  // src/subway/timetable/subway-timetable.config.ts reads these with fs.readFileSync(__dirname/<name>),
  // for the npm run data catalog's subway-topology check; revision 1 of subway-timetables is their copy.
  ["src/subway/timetable/korail-1-weekday.json", "dist/src/subway/timetable/korail-1-weekday.json"],
  ["src/subway/timetable/korail-1-holiday.json", "dist/src/subway/timetable/korail-1-holiday.json"],
  ["src/subway/timetable/korail-k1-weekday.json", "dist/src/subway/timetable/korail-k1-weekday.json"],
  ["src/subway/timetable/korail-k1-holiday.json", "dist/src/subway/timetable/korail-k1-holiday.json"],
  ["src/subway/timetable/seoul-4-weekday.json", "dist/src/subway/timetable/seoul-4-weekday.json"],
  ["src/subway/timetable/seoul-4-saturday.json", "dist/src/subway/timetable/seoul-4-saturday.json"],
  ["src/subway/timetable/seoul-4-holiday.json", "dist/src/subway/timetable/seoul-4-holiday.json"],
  ["src/subway/timetable/seoul-2-weekday.json", "dist/src/subway/timetable/seoul-2-weekday.json"],
  ["src/subway/timetable/seoul-2-saturday.json", "dist/src/subway/timetable/seoul-2-saturday.json"],
  ["src/subway/timetable/seoul-2-holiday.json", "dist/src/subway/timetable/seoul-2-holiday.json"],
  ["src/subway/timetable/seoul-3-weekday.json", "dist/src/subway/timetable/seoul-3-weekday.json"],
  ["src/subway/timetable/seoul-3-saturday.json", "dist/src/subway/timetable/seoul-3-saturday.json"],
  ["src/subway/timetable/seoul-3-holiday.json", "dist/src/subway/timetable/seoul-3-holiday.json"],
  ["src/subway/timetable/seoul-8-weekday.json", "dist/src/subway/timetable/seoul-8-weekday.json"],
  ["src/subway/timetable/seoul-8-saturday.json", "dist/src/subway/timetable/seoul-8-saturday.json"],
  ["src/subway/timetable/seoul-8-holiday.json", "dist/src/subway/timetable/seoul-8-holiday.json"],
  ["src/subway/timetable/shinbundang-d1-weekday.json", "dist/src/subway/timetable/shinbundang-d1-weekday.json"],
  ["src/subway/timetable/shinbundang-d1-holiday.json", "dist/src/subway/timetable/shinbundang-d1-holiday.json"],
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
