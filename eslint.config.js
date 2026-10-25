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
    // infra/media-url is pure (string checks over a constant origin), so a rule or a mapper imports it directly
    // rather than through a `.schema` that wraps it.
    regex: "(?:^|/)infra/(?!(?:i18n|types|media-url)$)",
    message: "A pure file reaches infra/ only for i18n lookups, types and media-url; take anything else as an argument.",
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

// The module scopes: every top-level folder of src/ (ending in "/") and every file at its root. The role,
// function, TypeScript and clock blocks below cover them all, so a new module is bound from its first file;
// the architecture tests derive the same list (__tests__/helpers/architecture/scopes.ts).
const MODULE_SCOPES = require("fs")
  .readdirSync(require("path").join(__dirname, "src"), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? [`src/${d.name}/`] : d.name.endsWith(".ts") ? [`src/${d.name}`] : []))
  .sort();

// Feature modules read the time through `Clock` (ADR 0011, D5): every scope but the shared layers.
const CLOCK_FREE_LAYERS = ["config", "http", "infra", "perimeter", "scheduling", "shared"];
const CLOCK_INJECT_DIRS = MODULE_SCOPES.filter(
  (scope) => !CLOCK_FREE_LAYERS.some((layer) => scope.startsWith(`src/${layer}/`)),
);

// moment-timezone reads the clock too: `moment()`, `moment.utc()` and `moment.now()` without an argument,
// and `moment.tz(zone)` with only the zone. `moment(now)` and `moment.tz(value, zone)` parse a given instant.
const MOMENT_NOW = [
  "CallExpression[callee.name='moment'][arguments.length=0]",
  "CallExpression[callee.object.name='moment'][callee.property.name='tz'][arguments.length<2]",
  "CallExpression[callee.object.name='moment'][callee.property.name=/^(?:utc|now)$/][arguments.length=0]",
].join(", ");

const CLOCK_INJECT_SYNTAX = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: "Read the time from the injected `Clock` (src/infra/clock.ts), not `new Date()`.",
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "Read the time from the injected `Clock` (src/infra/clock.ts), not `Date.now()`.",
  },
  {
    selector: MOMENT_NOW,
    message: "Read the time from the injected `Clock` (src/infra/clock.ts) and pass it in: `moment(clock.now())`.",
  },
];

// A constructor lists injected dependencies, not an argument list: ESLint's max-params
// counts both, so the function-cap limit is the constructor's 4 and functions are held to 3 here.
const PARAMS_SYNTAX = [
  {
    selector: ":function[params.length>3]:not(MethodDefinition[kind='constructor'] > FunctionExpression)",
    message: "A function takes at most 3 parameters: pass an options object.",
  },
  {
    selector: "MethodDefinition[kind='constructor'] > FunctionExpression[params.length>4]",
    message: "A constructor takes at most 4 injected dependencies; split the class.",
  },
];

const CLOCK_SYNTAX = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: "A pure file does not read the clock: take `now` as an argument.",
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "A pure file does not read the clock: take `now` as an argument.",
  },
  {
    selector: MOMENT_NOW,
    message: "A pure file does not read the clock: take `now` as an argument and pass it to moment.",
  },
];

// (A perimeter detail is left out of the public history.)
const FIREBASE_MODULE = "/^firebase-admin$|(?:^\\.|\\/infra)\\/firebase$/";
const FIREBASE_REEXPORT = "/^firebase-admin(?:$|\\/)|(?:^\\.|\\/infra)\\/firebase$/";

// no-restricted-syntax replaces rather than merges across blocks, and the role blocks above each
// set it for their files. The rules below run beside them under their own names: the same core
// rule, registered again by a local plugin, so a block that sets one leaves the others alone.
const CORE_RULES = require("eslint/use-at-your-own-risk").builtinRules;
const CORE_RESTRICTED_SYNTAX = CORE_RULES.get("no-restricted-syntax");
const SRC_SYNTAX_PLUGIN = {
  rules: {
    "zod-issues": CORE_RESTRICTED_SYNTAX,
    literals: CORE_RESTRICTED_SYNTAX,
    "spec-clock": CORE_RESTRICTED_SYNTAX,
    "schema-casts": CORE_RESTRICTED_SYNTAX,
    "schema-imports": CORE_RESTRICTED_SYNTAX,
    "module-loads": CORE_RESTRICTED_SYNTAX,
    "firebase-calls": CORE_RESTRICTED_SYNTAX,
    // An alias of no-restricted-imports, so the boundary blocks keep their own patterns.
    "import-paths": CORE_RULES.get("no-restricted-imports"),
    // Another alias, so the perimeter blocks keep their own patterns beside the feature and import-path blocks.
    "perimeter-imports": CORE_RULES.get("no-restricted-imports"),
    // An alias of id-denylist, so the glossary/<module> blocks keep theirs.
    "generic-names": CORE_RULES.get("id-denylist"),
  },
};

// A name that says nothing on its own (.claude/rules/naming.md, Words). Only the ones no source
// file uses: `data`, `item`, `value` and kin are also wire property names, so a denylist flags those.
const GENERIC_NAMES = ["info", "obj", "tmp", "helper", "manager"];

// A zod issue names where it is (ADR 0010, D5): parseConfigFile and the boot error print each
// issue's path, and an issue without one reads `root:` wherever it sits. zod takes an issue through
// `ctx.addIssue(…)` (also as `ctx["addIssue"]` or a destructured `addIssue`) and, in zod 4's `.check`,
// `ctx.issues.push(…)`; each spelling must carry its own `path`. A bare `addIssue(ctx, found)` is a
// local helper that sets the path itself, so only an object first argument is read.
const ISSUE_CALL =
  "CallExpression:matches([callee.property.name='addIssue'], [callee.property.value='addIssue'], [callee.name='addIssue'], " +
  "[callee.property.name='push'][callee.object.property.name='issues'])";
const ADD_ISSUE_SYNTAX = [
  {
    selector: `${ISSUE_CALL} > ObjectExpression.arguments:first-child:not(:has(> Property[key.name='path'])):not(:has(> Property[key.value='path']))`,
    message: "Give each zod issue its `path` (`path: []` when the issue is the whole value), so the error names the field.",
  },
  {
    selector: `${ISSUE_CALL}[callee.type='MemberExpression'] > :matches(Literal, TemplateLiteral).arguments:first-child`,
    message: "Pass an issue object with its `path` (`path: []` when the issue is the whole value), not a bare message.",
  },
  {
    selector: `${ISSUE_CALL} > ObjectExpression.arguments:first-child > Property[value.type='Identifier'][value.name='undefined']:matches([key.name='path'], [key.value='path'])`,
    message: "`path: undefined` is no path: name the field, or `path: []` when the issue is the whole value.",
  },
];

// An object-level `.refine` without a path reports at the object: name the field, or `path: []` to say the
// issue is the whole value. A field-level `.refine` takes its path from where the field sits.
// A refine counts as object-level on the object call itself or after up to two other refinements of it.
const OBJECT_REFINES = [0, 1, 2].map((between) => {
  const hop = "callee.object.";
  const steps = Array.from({ length: between }, (_, i) => `[${hop.repeat(i + 1)}callee.property.name=/^(?:refine|superRefine)$/]`);
  const object = `[${hop.repeat(between + 1)}callee.property.name=/^(?:object|strictObject|looseObject|extend)$/]`;
  return `CallExpression[callee.property.name='refine']${steps.join("")}${object}`;
});
const OBJECT_REFINE_SYNTAX = [
  {
    selector: OBJECT_REFINES.flatMap((refine) => [
      `${refine}[arguments.length<2]`,
      `${refine} > :matches(Literal, TemplateLiteral).arguments:nth-child(2)`,
      `${refine} > ObjectExpression.arguments:nth-child(2):not(:has(> Property[key.name='path'])):not(:has(> Property[key.value='path']))`,
    ]).join(", "),
    message: "Give an object-level refine its `path` (`path: []` when the issue is the whole object), so the error names the field.",
  },
];

// A `.schema` parses: its output type is what it checked. A cast through `unknown` (or a second cast) in a
// transform certifies fields the schema never read, and `satisfies z.ZodType<T>` holds either way.
const DOUBLE_CAST_SYNTAX = [
  {
    selector: ":matches(TSAsExpression, TSTypeAssertion) > :matches(TSAsExpression, TSTypeAssertion).expression",
    message: "No cast through unknown in a .schema: check the field, or leave it out of the type the schema returns.",
  },
  {
    // A cast to a zod schema type certifies an output the schema never checks, in one hop.
    selector:
      ":matches(TSAsExpression, TSTypeAssertion):matches([typeAnnotation.typeName.right.name='ZodType'], [typeAnnotation.typeName.name='ZodType'])",
    message: "No cast to z.ZodType in a .schema: check the field, or leave it out of the type the schema returns.",
  },
];

// A rule or mapper imports a `.schema` for its types only (PURE_IMPORT_PATTERNS is one import deep): a runtime
// value through a `.schema` would let a pure file reach whatever that schema imports.
const SCHEMA_IMPORT = "ImportDeclaration[importKind='value'][source.value=/\\.schema$/]";
const SCHEMA_IMPORT_MESSAGE =
  "A .rules or .mapper file imports a .schema for types only (`import type`): import the pure helper from where it lives.";
const SCHEMA_IMPORT_SYNTAX = [
  `${SCHEMA_IMPORT}:has(ImportSpecifier[importKind='value'])`,
  `${SCHEMA_IMPORT}:has(ImportDefaultSpecifier)`,
  `${SCHEMA_IMPORT}:has(ImportNamespaceSpecifier)`,
  `${SCHEMA_IMPORT}[specifiers.length=0]`,
].map((selector) => ({ selector, message: SCHEMA_IMPORT_MESSAGE }));

// A color or a web view path is a value the app reads, kept in one place: a `.constants` file
// (or the JSON config) holds it, and code imports its name.
// A bare six- or eight-digit hex string is read as a color only when it mixes letters and digits
// (`e65100`, `4CAF50`) or is bound to a name ending in `color`: an all-digit string is as often an id
// or a date (`202610`, `100100`) and an all-letter one a word (`facade`, `decade`), and no lexical test
// tells those from `003626`. A `#` prefix, `rgb(`/`rgba(` and a `0x` number are colors wherever they sit.
const HEX = "(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})";
const HASH_COLOR = `/^#${HEX}$/`;
const MIXED_HEX = `/^(?=[0-9A-Fa-f]*[A-Fa-f])(?=[0-9A-Fa-f]*[0-9])${HEX}$/`;
const ANY_HEX = `/^${HEX}$/`;
const RGB = "/^rgba?\\(/";
const COLOR_NAME = "/[Cc]olou?r$/";
const hexString = (pattern) => `:matches(Literal[value=${pattern}], TemplateLiteral[quasis.length=1] > TemplateElement[value.raw=${pattern}])`;
// A web view path opens a string (`/skku/x`, `skku/x`) or follows an origin in a template
// (`${origin}/skku/x`). An absolute URL to www.skku.edu also holds `/skku/`, but it is the school's
// site, not a web view page, so a `/skku/` after literal text is not read.
const WEBVIEW_PATH = "/^\\/?skku\\//";
const LITERAL_SYNTAX = [
  {
    selector: [
      hexString(HASH_COLOR),
      hexString(MIXED_HEX),
      `VariableDeclarator[id.name=${COLOR_NAME}] > Literal.init[value=${ANY_HEX}]`,
      `Property:matches([key.name=${COLOR_NAME}], [key.value=${COLOR_NAME}]) > Literal.value[value=${ANY_HEX}]`,
      `Literal[raw=/^0[xX]${HEX}$/]`,
    ].join(", "),
    message: "A hex color lives in a *.constants.ts file: import it by name.",
  },
  {
    selector: `:matches(Literal[value=${RGB}], TemplateLiteral > TemplateElement:first-child[value.raw=${RGB}])`,
    message: "An rgb() color lives in a *.constants.ts file: import it by name.",
  },
  {
    selector: [
      `Literal[value=${WEBVIEW_PATH}]`,
      `TemplateLiteral > TemplateElement:first-child[value.raw=${WEBVIEW_PATH}]`,
      "TemplateLiteral > TemplateElement:not(:first-child)[value.raw=/^\\/skku\\//]",
    ].join(", "),
    message: "A web view path (/skku/…) lives in a *.constants.ts file: import it by name.",
  },
];

// A spec in a module scope passes a fixed clock (tests.md, "What to double"): the real Clock makes the
// answer depend on the day the test runs, and lets one read see two different instants.
// An alias (`Clock as RealClock`), a namespace (`new clock.Clock()`) and a Nest provider (`providers: [Clock]`,
// `useClass: Clock`) build the same real Clock; a fake class says so in its name (`FixedClock`, `FakeClock`).
// An alias the name check cannot see (`Clock as Tick`, `Clock as FixedClock`) is refused where it is imported,
// and so is a subclass of the real Clock, whatever its name.
const REAL_CLOCK_NAME = "/^(?!Fixed|Fake).*Clock$/";
const SPEC_CLOCK_SYNTAX = [
  {
    selector: [
      `ImportDeclaration[importKind='value'] > ImportSpecifier[importKind='value'][imported.name='Clock'][local.name!='Clock']:not([local.name=${REAL_CLOCK_NAME}])`,
      "ClassDeclaration[superClass.name='Clock']",
    ].join(", "),
    message: "Import Clock under its own name and pass a fixed fake object (`{ now: () => NOW }`), not the real Clock renamed or extended.",
  },
  {
    selector: `NewExpression:matches([callee.name=${REAL_CLOCK_NAME}], [callee.property.name='Clock'])`,
    message: "Pass a fixed fake clock (`const clock: Clock = { now: () => NOW }`), not the real Clock.",
  },
  {
    selector: [
      `Property[key.name='providers'] > ArrayExpression > Identifier[name=${REAL_CLOCK_NAME}]`,
      `Property[key.name='useClass'] > Identifier.value[name=${REAL_CLOCK_NAME}]`,
    ].join(", "),
    message: "Provide a fixed fake clock (`{ provide: Clock, useValue: fakeClock }`), not the real Clock.",
  },
];

// ── Import boundaries (docs/decisions/0010-server-architecture.md, D3 and D9) ──
//
// Each boundary block is named `boundaries/...`. Its `ignores` name only the
// files the rule exempts by role (a repository, a spec, the Mongo owners), never
// a file that breaks it: __tests__/architecture/import-boundaries.test.ts fails
// on an ignored file that would violate the block.

const SHARED_DIRS = ["config", "http", "infra", "perimeter", "scheduling", "shared"];
// Every other top-level folder of src/ is a feature, so a new module is
// bounded from its first file.
const FEATURES = require("fs")
  .readdirSync(require("path").join(__dirname, "src"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !SHARED_DIRS.includes(d.name))
  .map((d) => d.name)
  .sort();

const PERIMETER_IMPLEMENTATION_PATTERNS = [
  {
    regex: "(?:^|/)perimeter/(?:local-dev|current)/",
    message: "Only src/perimeter/ reaches a perimeter implementation: inject its port from src/perimeter/perimeter.ports.",
  },
  {
    regex: "(?:^|/)private/",
    message: "Nothing imports the overlay's private build output: the registry loads it by path (ADR 0023, D4).",
  },
];

// Feature code and src/http/ reach src/perimeter/ through the ports file alone (ADR 0023, D8).
const PERIMETER_PORTS_ONLY_PATTERN = {
  regex: "^(?:\\.\\./)+perimeter/(?!perimeter\\.ports$)(?!(?:local-dev|current)/)",
  message: "Feature code and src/http/ import only src/perimeter/perimeter.ports: inject the port.",
};

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

// A handler takes the language from @Lang() (src/http/lang.decorator.ts), which
// throws when LangMiddleware did not run; a cast or a `?? "ko"` would hide that.
const LANG_SYNTAX = [
  {
    selector: "MemberExpression[object.name=/^(?:req|request)$/][property.name='lang']",
    message: "Take the language as a parameter: `@Lang() lang: SupportedLang` (src/http/lang.decorator.ts).",
  },
  {
    selector: "TSAsExpression[typeAnnotation.typeName.name='SupportedLang']",
    message: "Don't cast to SupportedLang: `@Lang()` hands a handler the request's language already typed.",
  },
];

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
                PERIMETER_PORTS_ONLY_PATTERN,
              ],
            },
          ],
        },
      };
    }),
  );
}

// Per-role size caps (ADR 0010, D9), in __tests__/architecture/caps/role-max-lines.json. Each is the largest
// file of that role plus at most 10 lines, comment lines counted (__tests__/architecture/size-ratchets.test.ts
// keeps them there). A file over its role's cap is split, or its flow becomes a sub-module (D3). Each commit that
// raises a cap carries `Architecture-Debt: __tests__/architecture/caps/role-max-lines.json` (list-growth).

/** Globs over the module scopes for files named `*<tail>`: `scopeGlobs(".service.ts")`. */
function scopeGlobs(tail) {
  return MODULE_SCOPES.flatMap((scope) =>
    scope.endsWith("/") ? [`${scope}**/*${tail}`] : scope.endsWith(tail) ? [scope] : [],
  );
}

const ROLE_MAX_LINES = require("./__tests__/architecture/caps/role-max-lines.json");

// A file over its role's cap with no domain seam to split it along carries a reasoned per-file cap instead
// (ADR 0010 D9): __tests__/architecture/exemptions/size-caps.json, { "<file>": { "max": <lines>, "reason": "…" } }.
// Each block comes after the role blocks, so it raises only that file's max-lines; size-ratchets.test.ts holds
// each max within 10 of the file and fails an entry whose file is gone or back under its role's cap.
const SIZE_CAP_EXEMPTIONS = require("./__tests__/architecture/exemptions/size-caps.json");

function sizeCapExemptionBlocks() {
  return Object.entries(SIZE_CAP_EXEMPTIONS).map(([file, { max }]) => ({
    name: `size-exemption/${file}`,
    files: [file],
    rules: { "max-lines": ["error", { max, skipBlankLines: true, skipComments: false }] },
  }));
}

function roleSizeBlocks() {
  return Object.entries(ROLE_MAX_LINES).map(([role, max]) => ({
    name: `size/${role}`,
    files: scopeGlobs(`.${role}.ts`),
    rules: { "max-lines": ["error", { max, skipBlankLines: true, skipComments: false }] },
  }));
}

// Function caps over the module scopes (ADR 0010, D9): the longest function plus at
// most 10 lines, comment lines counted as in max-lines; depth, parameters and
// complexity at the worst. Specs are left out: a describe callback is long by design.
const MIGRATED_FUNCTION_LIMITS = {
  "max-lines-per-function": ["error", { max: 37, skipBlankLines: true, skipComments: false }],
  "max-depth": ["error", 2],
  // A constructor of 4 injected dependencies is allowed; PARAMS_SYNTAX holds functions to 3.
  "max-params": ["error", 4],
  complexity: ["error", 9],
};

// no-restricted-syntax replaces rather than merges, so each kind of source file gets
// one block with every selector it needs: log, its role's own, params, and the clock.
function migratedSyntaxBlocks() {
  const underClockDirs = MODULE_SCOPES.filter((scope) => CLOCK_INJECT_DIRS.some((dir) => scope.startsWith(dir)));
  const elsewhere = MODULE_SCOPES.filter((scope) => !underClockDirs.includes(scope));
  const globs = (scopes, tail) =>
    scopes.flatMap((scope) => (scope.endsWith("/") ? [`${scope}**/*${tail}`] : scope.endsWith(tail) ? [scope] : []));
  const pure = [".rules.ts", ".mapper.ts", ".query.ts"];
  const blocks = [];
  for (const [scopes, injectClock] of [
    [underClockDirs, true],
    [elsewhere, false],
  ]) {
    const clock = injectClock ? CLOCK_INJECT_SYNTAX : [];
    blocks.push(
      {
        name: `migrated/syntax${injectClock ? "-clock" : ""}`,
        files: globs(scopes, ".ts"),
        ignores: ["**/*.spec.ts", ...pure.map((t) => `**/*${t}`), "**/*.controller.ts"],
        rules: { "no-restricted-syntax": ["error", ...LOG_SYNTAX, ...PARAMS_SYNTAX, ...clock] },
      },
      {
        name: `migrated/syntax-controller${injectClock ? "-clock" : ""}`,
        files: globs(scopes, ".controller.ts"),
        ignores: ["**/*.spec.ts"],
        rules: { "no-restricted-syntax": ["error", ...LOG_SYNTAX, ...LANG_SYNTAX, ...PARAMS_SYNTAX, ...clock] },
      },
      {
        name: `migrated/syntax-pure${injectClock ? "-clock" : ""}`,
        files: pure.flatMap((t) => globs(scopes, t)),
        ignores: ["**/*.spec.ts"],
        rules: { "no-restricted-syntax": ["error", ...LOG_SYNTAX, ...CLOCK_SYNTAX, ...PARAMS_SYNTAX] },
      },
    );
  }
  return blocks;
}

/** The specs of the module scopes: `src/` specs, and a top-level module's `__tests__/nest/<module>/` tests. */
function scopeSpecGlobs() {
  return MODULE_SCOPES.flatMap((scope) => {
    if (!scope.endsWith("/")) return [scope.replace(/\.ts$/, ".spec.ts")];
    const topLevel = /^src\/([^/]+)\/$/.exec(scope);
    return [`${scope}**/*.spec.ts`, ...(topLevel ? [`__tests__/nest/${topLevel[1]}/**/*.ts`] : [])];
  });
}

// Hash-locked vendored sources (.contracts.lock.json) are not edited here (ADR 0010, D10), so the scoped
// function and TypeScript rules leave them alone; their producer repository owns their shape.
const VENDORED_SOURCES = Object.values(require("./.contracts.lock.json").contracts)
  .map((contract) => contract.path)
  .filter((p) => p.startsWith("src/") && p.endsWith(".ts"));

function migratedFunctionBlock() {
  return {
    name: "size-ratchets/migrated",
    files: scopeGlobs(".ts"),
    ignores: ["src/**/*.spec.ts", ...VENDORED_SOURCES],
    rules: MIGRATED_FUNCTION_LIMITS,
  };
}

// TypeScript rules every module meets (ADR 0010, D9): every exported
// function and public method declares its return type, and no `!` asserts a value
// away; a regex group is read through captureGroups (src/shared/regex.util.ts).
function migratedTypescriptBlock() {
  return {
    name: "migrated/typescript",
    files: scopeGlobs(".ts"),
    ignores: ["src/**/*.spec.ts", ...VENDORED_SOURCES],
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  };
}

// Each feature module's forbidden synonyms: the backticked names in the Not
// column of docs/explanation/<module>-architecture.md, nothing else (ADR 0010,
// D14; the glossary-coverage test keeps the two in step).
const GLOSSARY_NOT = {
  "app-config": ["AppSettings", "forceUpdate"],
  building: ["buildingId", "buildingNo", "roomId", "level", "bucket", "searchData", "term", "geometryDoc"],
  bus: ["busGroupConfig", "busStop", "seqNo", "trip", "prediction"],
  health: ["isAlive", "isHealthy"],
  journey: ["trip", "itinerary", "corridor"],
  calendar: ["restDay", "holidayCache", "schoolYear"],
  meals: ["restaurant", "diningHall", "mealType"],
  map: ["festivalConfig", "layerConfig", "eventWindow", "currentFestival", "filterButton", "exclusiveGroup", "categoryStyle", "sheetBody", "isFallback"],
  miniapps: ["appRegistry", "inbox", "readBy"],
  notices: ["NoticeDto", "tabConfig", "FindResult"],
  subway: ["subwayStop", "stationLine", "bound", "prevStations", "adapter", "trainId", "badge"],
  ui: ["homeConfig", "widget", "slider", "period", "shortcut", "campusConfig", "busItem", "scrollItem"],
};

function glossaryDenylistBlocks() {
  return Object.entries(GLOSSARY_NOT).map(([module, names]) => ({
    name: `glossary/${module}`,
    files: [`src/${module}/**/*.ts`],
    rules: { "id-denylist": ["error", ...names] },
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
      // tsc rejects a real redeclaration (TS2451); the base rule reads overload signatures as one.
      "no-redeclare": "off",
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
    // A nested ternary hides a decision: name it with an `if`, a lookup or a function.
    // src/ only: __tests__/, scripts/ and this file still nest some.
    name: "readability/src",
    files: ["src/**/*.ts"],
    // A comma operator packs two steps into one expression (`return (drops.push(x), null)`) to fit a cap.
    rules: { "no-nested-ternary": "error", "no-sequences": ["error", { allowInParentheses: false }] },
  },
  {
    // Size ratchets (ADR 0010, D9): each limit is today's worst file or
    // function, so nothing grows past it. Lower one when its worst shrinks;
    // never raise one. max-lines counts comment lines (D10). Errors, not warnings.
    name: "size-ratchets",
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.spec.ts"],
    rules: {
      "max-lines": ["error", { max: 337, skipBlankLines: true, skipComments: false }],
      "max-lines-per-function": ["error", { max: 37, skipBlankLines: true, skipComments: true }],
      complexity: ["error", 11],
      "max-params": ["error", 4],
    },
  },
  ...roleSizeBlocks(),
  ...sizeCapExemptionBlocks(),
  migratedFunctionBlock(),
  migratedTypescriptBlock(),
  ...glossaryDenylistBlocks(),
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
  {
    // A `.wire` schema exports to JSON Schema for another repository (ADR 0010,
    // D13): structure and the literals it names, nothing a refinement needs. Its
    // one pattern also covers boundaries/get-client's, which it replaces here.
    name: "boundaries/wire",
    files: ["src/**/*.wire.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!zod$)(?!.*\\.(?:wire|constants)$)",
              message:
                "A .wire file imports only zod, other .wire files and .constants: brands, transforms and refinements go in the .schema that wraps it.",
            },
          ],
        },
      ],
    },
  },
  {
    // This block replaces the src block's no-restricted-syntax for controllers,
    // so it carries the log selectors along.
    name: "boundaries/lang",
    files: ["src/**/*.controller.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...LOG_SYNTAX, ...LANG_SYNTAX],
    },
  },
  ...migratedSyntaxBlocks(),
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
    // ADR 0023, D8: src/perimeter/ is a shared layer, so no feature type or value reaches a port or an implementation.
    name: "boundaries/perimeter-layer",
    files: ["src/perimeter/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `^(?:\\.\\./)+(?:${FEATURES.join("|")})/`,
              message: "src/perimeter/ is a shared layer and imports no feature module: move what it needs to src/shared/.",
            },
          ],
        },
      ],
    },
  },
  {
    // ADR 0023, D8: only src/perimeter/ reaches an implementation set (its own files name it `./local-dev/…`,
    // never through `perimeter/`), and no file names the overlay's private build output, which the registry loads
    // by path (src/perimeter/perimeter-overlay.rules.ts).
    name: "boundaries/perimeter",
    files: ["src/**/*.ts"],
    plugins: { "src-syntax": SRC_SYNTAX_PLUGIN },
    rules: { "src-syntax/perimeter-imports": ["error", { patterns: PERIMETER_IMPLEMENTATION_PATTERNS }] },
  },
  {
    // Replaces the block above for src/http/, its patterns kept: the pipeline injects a port (ADR 0023, D8).
    name: "boundaries/http",
    files: ["src/http/**/*.ts"],
    plugins: { "src-syntax": SRC_SYNTAX_PLUGIN },
    rules: { "src-syntax/perimeter-imports": ["error", { patterns: [...PERIMETER_IMPLEMENTATION_PATTERNS, PERIMETER_PORTS_ONLY_PATTERN] }] },
  },
  {
    // The boundaries above read import declarations: a `require()` or an `import()` call would pass them all,
    // so non-spec src/ loads modules only through `import`. Specs may still require a module after setup.
    name: "boundaries/module-loads",
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.spec.ts"],
    plugins: { "src-syntax": SRC_SYNTAX_PLUGIN },
    rules: {
      "@typescript-eslint/no-require-imports": "error",
      "src-syntax/module-loads": [
        "error",
        { selector: "ImportExpression", message: "Import the module at the top of the file: the import boundaries do not read an `import()` call." },
      ],
    },
  },
  {
    // (A perimeter detail is left out of the public history.)
    name: "firebase/no-credential",
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.spec.ts"],
    plugins: { "src-syntax": SRC_SYNTAX_PLUGIN },
    rules: {
      "src-syntax/firebase-calls": [
        "error",
        {
          selector: "ImportDeclaration[source.value=/^firebase-admin\\//]",
          message: "Use the firebase-admin namespace through src/perimeter/current/private-file: its subpath entry points reach services that need a credential.",
        },
        {
          selector: `:matches(ExportNamedDeclaration, ExportAllDeclaration)[source.value=${FIREBASE_REEXPORT}]`,
          message: "Do not re-export Firebase: a use through the re-export escapes the `admin` checks.",
        },
        {
          selector:
            `ImportDeclaration[source.value=${FIREBASE_MODULE}] > :matches(ImportNamespaceSpecifier, ImportSpecifier, ImportDefaultSpecifier[local.name!='admin'])`,
          message: "Import Firebase as `import admin from …`: the firebase/no-credential selectors read the name `admin`.",
        },
        {
          selector: [
            "CallExpression[callee.property.name='initializeApp'] > ObjectExpression.arguments > :not(Property[key.name='projectId'])",
            "CallExpression[callee.property.name='initializeApp']:not([arguments.0.type='ObjectExpression']:matches([arguments.length=1], [arguments.length=2][arguments.1.type='Literal'][arguments.1.value=/^[a-z][a-z-]*$/]))",
          ].join(", "),
          message: "initializeApp takes `{ projectId }` alone, and at most a literal app name: the server holds no service-account credential.",
        },
        {
          selector: [
            "CallExpression[callee.property.name='verifyIdToken'][arguments.length!=1]",
            "CallExpression[callee.property.name='verifyIdToken'] > SpreadElement.arguments",
            "MemberExpression[property.name='verifyIdToken']:not(CallExpression > MemberExpression.callee)",
          ].join(", "),
          message: "Call verifyIdToken with the token alone: checkRevoked reads the user record, which needs a service-account credential.",
        },
        {
          // admin.auth and admin.initializeApp only as callees, so neither is read as a value and called later
          // unchecked. A credential inside initializeApp's options is reported once, by the initializeApp selector.
          selector: [
            "MemberExpression[object.name='admin']",
            ":not(CallExpression > MemberExpression.callee[property.name=/^(?:auth|initializeApp)$/])",
            ":not(CallExpression[callee.property.name='initializeApp'] MemberExpression)",
          ].join(""),
          message: "Only admin.auth() and admin.initializeApp() run without a credential: Firestore, messaging and the rest need a service account.",
        },
        {
          selector: [
            "Identifier[name='admin']:not(:matches(ImportDefaultSpecifier, ImportNamespaceSpecifier, ImportSpecifier) > Identifier)",
            ":not(MemberExpression > Identifier.object)",
            ":not(TSExportAssignment > Identifier.expression)",
            // A property or member named `admin` (`user.admin`, `{ admin: true }`) is not the binding.
            ":not(MemberExpression[computed=false] > Identifier.property)",
            ":not(:matches(Property, PropertyDefinition, MethodDefinition, TSPropertySignature, TSMethodSignature)[computed=false] > Identifier.key)",
          ].join(""),
          message: "Use `admin` only as `admin.auth()` or `admin.initializeApp()`: an alias, a destructuring or an argument escapes these checks.",
        },
        {
          selector: [
            "MemberExpression[object.callee.object.name='admin'][object.callee.property.name='auth'][property.name!='verifyIdToken']",
            ":not(MemberExpression) > CallExpression[callee.object.name='admin'][callee.property.name='auth']",
          ].join(", "),
          message: "Call admin.auth().verifyIdToken() and nothing else on it: every other Auth call needs a service-account credential.",
        },
      ],
    },
  },
  {
    // The boundary patterns match a specifier as written, so `../../building/../notices/x` would pass as building's.
    name: "boundaries/import-paths",
    files: ["src/**/*.ts"],
    plugins: { "src-syntax": SRC_SYNTAX_PLUGIN },
    rules: {
      "src-syntax/import-paths": [
        "error",
        {
          patterns: [
            {
              regex: "(?:^|/)[^./][^/]*/\\.\\.(?:/|$)",
              message: "Write the import path without a `..` after a folder name: the boundaries read the path as written.",
            },
          ],
        },
      ],
    },
  },
  {
    // A spec may build a pathless issue on purpose, to test how one is answered.
    name: "zod/issue-path",
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.spec.ts"],
    plugins: { "src-syntax": SRC_SYNTAX_PLUGIN },
    rules: { "src-syntax/zod-issues": ["error", ...ADD_ISSUE_SYNTAX, ...OBJECT_REFINE_SYNTAX] },
  },
  {
    name: "schemas/no-double-cast",
    files: ["src/**/*.schema.ts"],
    ignores: ["src/**/*.spec.ts"],
    plugins: { "src-syntax": SRC_SYNTAX_PLUGIN },
    rules: { "src-syntax/schema-casts": ["error", ...DOUBLE_CAST_SYNTAX] },
  },
  {
    name: "boundaries/pure-schema",
    files: ["src/**/*.rules.ts", "src/**/*.mapper.ts"],
    plugins: { "src-syntax": SRC_SYNTAX_PLUGIN },
    rules: { "src-syntax/schema-imports": ["error", ...SCHEMA_IMPORT_SYNTAX] },
  },
  {
    name: "naming/generic-names",
    files: scopeGlobs(".ts"),
    ignores: ["src/**/*.spec.ts"],
    plugins: { "src-syntax": SRC_SYNTAX_PLUGIN },
    rules: { "src-syntax/generic-names": ["error", ...GENERIC_NAMES] },
  },
  {
    // docs/explanation/miniapps-architecture.md (Glossary): a class writes `Miniapps…` and a constant `MINIAPP…`;
    // every other name writes `miniApp`/`MiniApp`, so `miniappX`/`MiniappX` is a third spelling.
    name: "naming/miniapp-spelling",
    files: ["src/**/*.ts"],
    rules: { "id-match": ["error", "^(?!.*[mM]iniapp[A-Z]).*$", { properties: true, classFields: true }] },
  },
  {
    name: "specs/fixed-clock",
    files: scopeSpecGlobs(),
    plugins: { "src-syntax": SRC_SYNTAX_PLUGIN },
    rules: { "src-syntax/spec-clock": ["error", ...SPEC_CLOCK_SYNTAX] },
  },
  {
    // A spec states the values it expects, so it is left out.
    name: "boundaries/literals",
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.spec.ts", "src/**/*.constants.ts"],
    plugins: { "src-syntax": SRC_SYNTAX_PLUGIN },
    rules: { "src-syntax/literals": ["error", ...LITERAL_SYNTAX] },
  },
  {
    files: ["__tests__/**/*.{js,ts}"],
    languageOptions: {
      globals: jestGlobals,
    },
  },
  {
    ignores: [
      "node_modules/",
      "coverage/",
      "dist/",
      ".claude/worktrees/",
      "swagger/swagger-output.json",
      "src/**/*.generated.ts",
    ],
  },
];
