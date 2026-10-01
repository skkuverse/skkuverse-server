const js = require("@eslint/js");
const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");

const sharedRules = {
  // Pre-TS hardening — catch implicit-coercion and scope bugs JS lets through
  // but TS strict mode treats as compile errors or hidden footguns.
  // `{ null: "ignore" }` preserves the `value == null` idiom (null + undefined in one check).
  "eqeqeq": ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "prefer-const": "error",
  // Only multi-line blocks need braces; `if (x) return;` stays terse.
  "curly": ["error", "multi-line"],
  "no-shadow": "error",
  "no-throw-literal": "error",
  "no-useless-concat": "error",
};

const sharedGlobals = {
  // Node.js globals
  require: "readonly",
  module: "readonly",
  exports: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  // Node 18+ globals
  fetch: "readonly",
  AbortController: "readonly",
  AbortSignal: "readonly",
};

// A call to the shared pino logger or a request's `req.log`.
const LOG_CALL =
  ":matches(CallExpression[callee.object.name='logger'], CallExpression[callee.object.property.name='log'])" +
  "[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/]";

const jestGlobals = {
  describe: "readonly",
  it: "readonly",
  test: "readonly",
  expect: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  afterAll: "readonly",
  jest: "readonly",
};

module.exports = [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: sharedGlobals,
    },
    rules: {
      // Promoted to error: incomplete refactor artifacts shouldn't pass CI.
      "no-unused-vars": ["error", { argsIgnorePattern: "^(_|next)", caughtErrorsIgnorePattern: "^_" }],
      ...sharedRules,
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: sharedGlobals,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Replace base no-unused-vars with @typescript-eslint version
      // (handles TS-specific cases: type imports, enum members, etc.)
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^(_|next)", caughtErrorsIgnorePattern: "^_" }],
      // TS handles undefined identifiers at compile time; the lint rule mis-flags
      // global type augmentations (NodeJS.Timeout, Express.Request, etc.).
      "no-undef": "off",
      ...sharedRules,
      // no-shadow base rule also disabled in TS (TS-specific version handles enums/types correctly)
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
    },
  },
  {
    // Log line conventions (docs/reference/logging.md). A line is found by its
    // `event`, not its wording, and a stack survives only as an Error object:
    //   logger.warn({ event: "bus.hssc.fetch_failed", err }, "HSSC fetch failed")
    files: ["src/**/*.ts"],
    rules: {
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: `${LOG_CALL}[arguments.0.type!='ObjectExpression']`,
          message:
            "Log calls take a fields object first: logger.info({ event: \"domain.subject.verb\", ... }, \"message\").",
        },
        {
          selector: `${LOG_CALL} > ObjectExpression.arguments:first-child:not(:has(> Property[key.name='event']))`,
          message: "Log fields need an `event` key (domain.subject.verb) — it is what a query or alert matches on.",
        },
        {
          selector: `${LOG_CALL} > TemplateLiteral[expressions.length>0]`,
          message: "Keep the message static and put the values in fields, so the line can be grouped and queried.",
        },
        {
          selector: `${LOG_CALL} > ObjectExpression > Property[key.name='err'][value.type!='Identifier']`,
          message:
            "Pass the Error itself as `err` (`{ err }`), not its message — the serializer keeps the type and stack and strips request config.",
        },
      ],
    },
  },
  {
    // LEAF modules of the catalogue ⇄ layer-set seam. `map-layerset.config.ts`
    // runs `CONFIG_FILES.map(loadOne)` in its module body and imports these two
    // to validate a festival's chips against the served catalogue; if either
    // ever imported it — or anything that does — back, the half-initialised
    // module would be the one running loadOne, and `BASE_LAYERS` would be
    // `undefined` inside the import-time check with a TypeError naming nothing
    // useful. Their headers say so; this is what makes it fail lint instead.
    //
    // Living in one directory now does not make the cycle less real: these two
    // are imported BY the loader, so nothing they import may reach it again.
    files: ["src/map/map-layers.data.ts", "src/map/map-chips.data.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Both spellings: these modules are siblings now, so the import
              // that would close the cycle is written "./map-layerset.config",
              // which a "**/"-only glob does not reliably match.
              group: [
                "**/map-layerset.config",
                "./map-layerset.config",
                "**/map-active-layerset",
                "./map-active-layerset",
                "**/map-places.data",
                "./map-places.data",
                "**/map-config.data",
                "./map-config.data",
                "**/map-event-overlays.data",
                "./map-event-overlays.data",
              ],
              message:
                "leaf module: this import closes a cycle through map-layerset.config (see the file header).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["__tests__/**/*.{js,ts}"],
    languageOptions: {
      globals: jestGlobals,
    },
  },
  {
    ignores: ["node_modules/", "coverage/", "dist/", "swagger/swagger-output.json"],
  },
];
