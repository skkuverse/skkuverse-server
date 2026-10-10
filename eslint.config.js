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

// Log line conventions (docs/reference/logging.md). A line is found by its
// `event`, not its wording, and a stack survives only as an Error object:
//   logger.warn({ event: "bus.hssc.fetch_failed", err }, "HSSC fetch failed")
// Shared because a later block that sets no-restricted-syntax replaces these
// for its files.
const LOG_SYNTAX = [
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
];

// `.rules`, `.mapper` and `.query` files are pure (ADR 0010, D1 and D4): no
// IO, and the clock is passed in. Type imports stay allowed through the
// patterns below because none of them names a module a pure file needs types
// from: class-role files export no types.
const PURE_IMPORT_PATTERNS = [
  {
    regex: "\\.(?:module|controller|service|repository|client|poller)$",
    message: "A pure file does no IO: take the data as an argument; the service calls the repository or client.",
  },
  {
    regex: "(?:^|/)infra/(?!(?:i18n|types)$)",
    message: "A pure file reaches infra/ only for i18n lookups and types; take anything else as an argument.",
  },
  {
    regex: "(?:^|/)http/(?!app\\.error$)",
    message: "A pure file reaches http/ only for AppError; the HTTP pipeline stays out of rules and mappers.",
  },
  {
    regex: "(?:^|/)scheduling/",
    message: "A pure file does not schedule work; a poller registers it.",
  },
  {
    regex: "^(?:axios|fs|node:fs|firebase-admin)$|^@(?:nestjs|sentry)/",
    message: "A pure file does no IO and knows no framework: move the call to a client, repository or service.",
  },
];

// Mongo syntax lives in repositories and `.query` files only (ADR 0010, D2).
// A rule or mapper may not import "mongodb", types included: a decision that
// has to reach the database is split into the rule and its Mongo form.
const MONGO_PATTERN = {
  regex: "^mongodb$",
  message:
    "Rules and mappers speak the domain, not Mongo: put filters, pipelines and updates in the repository or a *.query.ts.",
};

const QUERY_IMPORT_PATTERN = {
  regex: "\\.query$",
  message: "Only a repository runs a query: import the *.query.ts from the module's repository.",
};

const CLOCK_SYNTAX = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: "A pure file does not read the clock: take `now` as an argument.",
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "A pure file does not read the clock: take `now` as an argument.",
  },
];

// ── Import boundaries (docs/decisions/0010-server-architecture.md, D3 and D9) ──
//
// Each boundary block is named `boundaries/...`. Its `ignores` hold the files
// that broke the rule when it was added (VIOLATORS). Never add one:
// __tests__/architecture/import-boundaries.test.ts fails when a listed file no
// longer violates, so each list only shrinks as modules are migrated.

const SHARED_DIRS = ["config", "http", "infra", "scheduling", "shared"];
// Every other top-level folder of src/ is a feature, so a new module is
// bounded from its first file.
const FEATURES = require("fs")
  .readdirSync(require("path").join(__dirname, "src"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !SHARED_DIRS.includes(d.name))
  .map((d) => d.name)
  .sort();

const GET_CLIENT_PATTERN = {
  regex: "(?:^|/)infra/db$|^\\./db$",
  importNames: ["getClient"],
  message: "Only a *.repository.ts reaches Mongo: add a named query to the module's repository.",
};

const MONGO_COLLECTION_PATTERN = {
  regex: "(?:^|/)infra/mongo$",
  importNames: ["mongoCollection"],
  message: "Only a *.repository.ts reaches Mongo: add a named query to the module's repository.",
};

const VIOLATORS = {
  // Rules and mappers that build Mongo syntax (ADR 0010, D2).
  pure: [],
  // Repositories that import a mapper (ADR 0010, D2): they return documents,
  // and the service maps them.
  repository: [],
  getClient: [
    "src/ad/ad.data.ts",
    "src/bus/cache/bus-cache.service.ts",
    "src/bus/eta/eta-store.ts",
    "src/bus/schedule/schedule-db.ts",
    "src/bus/schedule/schedule.service.ts",
    "src/map/map-places.data.ts",
    "src/miniapps/miniapps.data.ts",
    "src/notices/notices.data.ts",
  ],
  features: {
    app: ["src/app/app-feature.service.ts"],
    map: ["src/map/map-event-overlays.data.ts"],
    ui: ["src/ui/home/home-layout.schema.ts", "src/ui/home/home-layout.ts", "src/ui/ui/ui.buslist.ts"],
  },
};

/** One block per feature and folder depth: the regex knows how many `../` leave the module. */
function featureBoundaryBlocks() {
  return FEATURES.flatMap((feature) =>
    [1, 2, 3, 4, 5].map((depth) => {
      const up = "\\.\\./".repeat(depth);
      // A spec may import the shared test helpers.
      const stay = [...SHARED_DIRS, feature, "\\.\\./__tests__"].join("|");
      return {
        name: `boundaries/feature/${feature}/depth-${depth}`,
        files: [`src/${feature}/${"*/".repeat(depth - 1)}*.ts`],
        ignores: (VIOLATORS.features[feature] ?? []).filter((f) => f.split("/").length === depth + 2),
        rules: {
          "@typescript-eslint/no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  regex: `^${up}(?!(?:${stay})/)[^/]+/(?!.*\\.(?:module|service)$)`,
                  allowTypeImports: true,
                  message:
                    "Feature modules meet through DI: import another module's *.module or *.service, use `import type` for its types, or move a pure helper to src/shared/.",
                },
              ],
            },
          ],
        },
      };
    }),
  );
}

// Per-role size caps for migrated modules (ADR 0010, D9). Each is the largest
// file of that role in a migrated module plus at most 10 lines, comment lines
// counted (__tests__/architecture/size-ratchets.test.ts keeps them there). A
// module joins MIGRATED_MODULES when its migration lands; a file over its
// role's cap is split, or its flow becomes a sub-module (D3).
const MIGRATED_MODULES = ["building"];
const ROLE_MAX_LINES = {
  client: 160,
  controller: 37,
  document: 130,
  mapper: 154,
  module: 18,
  poller: 33,
  query: 173,
  repository: 187,
  rules: 92,
  schema: 31,
  service: 242,
  types: 58,
};

function roleSizeBlocks() {
  return Object.entries(ROLE_MAX_LINES).map(([role, max]) => ({
    name: `size/${role}`,
    files: MIGRATED_MODULES.map((m) => `src/${m}/**/*.${role}.ts`),
    rules: { "max-lines": ["error", { max, skipBlankLines: true, skipComments: false }] },
  }));
}

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
    // Log line conventions (LOG_SYNTAX above).
    files: ["src/**/*.ts"],
    rules: {
      "no-console": "error",
      "no-restricted-syntax": ["error", ...LOG_SYNTAX],
    },
  },
  {
    // Size ratchets (ADR 0010, D9): each limit is today's worst file or
    // function, so nothing grows past it. Lower them as modules are migrated;
    // never raise one. max-lines counts comment lines (D10). Errors, not warnings.
    name: "size-ratchets",
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.spec.ts"],
    rules: {
      "max-lines": ["error", { max: 553, skipBlankLines: true, skipComments: false }],
      "max-lines-per-function": ["error", { max: 122, skipBlankLines: true, skipComments: true }],
      complexity: ["error", 47],
      "max-params": ["error", 7],
    },
  },
  ...roleSizeBlocks(),
  {
    // Also keeps `.query` files to repositories: one block per file set, since
    // a later block replaces a rule's options rather than merging them.
    name: "boundaries/get-client",
    files: ["src/**/*.ts"],
    ignores: [
      "src/**/*.repository.ts",
      "src/**/*.spec.ts",
      "src/infra/db.ts",
      "src/infra/mongo.ts",
      ...VIOLATORS.getClient,
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [GET_CLIENT_PATTERN, MONGO_COLLECTION_PATTERN, QUERY_IMPORT_PATTERN] },
      ],
    },
  },
  {
    name: "boundaries/repository",
    files: ["src/**/*.repository.ts"],
    ignores: VIOLATORS.repository,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "\\.(?:mapper|service|controller|poller|client)$",
              message:
                "A repository returns documents: the service maps them and calls clients and other services.",
            },
          ],
        },
      ],
    },
  },
  {
    // This block replaces boundaries/get-client's options for these files; its
    // infra/ pattern covers infra/db. It uses the core rule because the feature
    // blocks own @typescript-eslint/no-restricted-imports, and a later block
    // replaces a rule's options rather than merging them. For the same reason
    // it carries the log selectors along with the clock ones.
    name: "boundaries/pure",
    files: ["src/**/*.rules.ts", "src/**/*.mapper.ts"],
    ignores: VIOLATORS.pure,
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...PURE_IMPORT_PATTERNS, MONGO_PATTERN, QUERY_IMPORT_PATTERN] },
      ],
      "no-restricted-syntax": ["error", ...LOG_SYNTAX, ...CLOCK_SYNTAX],
    },
  },
  {
    // A `.query` builds Mongo syntax and runs nothing: pure like a rule, but
    // "mongodb" types are its subject.
    name: "boundaries/query",
    files: ["src/**/*.query.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: PURE_IMPORT_PATTERNS }],
      "no-restricted-syntax": ["error", ...LOG_SYNTAX, ...CLOCK_SYNTAX],
    },
  },
  ...featureBoundaryBlocks(),
  {
    name: "boundaries/shared",
    files: ["src/shared/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `^(?:\\.\\./)+(?:${FEATURES.join("|")})/`,
              message: "src/shared/ holds pure helpers and imports no feature module.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "boundaries/infra",
    files: ["src/infra/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `^(?:\\.\\./)+(?:http|${FEATURES.join("|")})/`,
              message: "src/infra/ wraps the outside world and the process; it imports neither http/ nor a feature.",
            },
          ],
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
            // This block replaces boundaries/get-client's options for these
            // two files, so it carries that pattern too.
            GET_CLIENT_PATTERN,
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
