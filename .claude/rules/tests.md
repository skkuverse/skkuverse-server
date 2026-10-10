---
paths:
  - "__tests__/**"
  - "src/**/*.spec.ts"
  - "jest.config.js"
  - "jest.setup.ts"
---

# Test conventions

- Where a test lives (ADR 0010, D11):
  - A unit test sits next to its source as `src/<path>/<name>.spec.ts`: `src/infra/cached-loader.spec.ts` tests `src/infra/cached-loader.ts`. Specs are excluded from `tsconfig.json` and `dist/` (the build fails if one gets there), from coverage, and from the size ratchets; `npm run typecheck` checks them through `tsconfig.test.json`.
  - (An operations detail is left out of the public history.)
  - The unit tests of a module not yet migrated stay in `__tests__/nest/<module>/` until its migration moves them.
  - `__tests__/architecture/` holds the architecture rules; `__tests__/helpers/` is shared infrastructure, excluded from collection and coverage (`jest.config.js`).
- Route tests build an app with `__tests__/helpers/nest/build-<module>-app.ts` (ad, building, bus, map, notices, ui). Each builder copies the `src/main.ts` pipeline by hand (request logging, JSON body, `LangMiddleware`, `ResponseInterceptor`, `HttpExceptionFilter`) and takes `{ provide, useValue }` overrides. Stub every service whose `onModuleInit` reaches Mongo, or app init hangs.
- No test reaches MongoDB or an external API. Mock modules with `jest.mock()` (common targets: `src/infra/logger`, `src/infra/db`, `axios`, `src/infra/fcm`).
- `jest.setup.ts` gives every required env var a dummy value when unset. A new required var needs an entry there too.
- Jest runs with `NODE_ENV=test`: DB names get `_test`, and missing config does not exit.
- ts-jest only transpiles (`diagnostics: false`, lax `tsconfig.test.json`). Run `npm run typecheck` to catch type errors in tests.
- Assert on logged fields with `__tests__/helpers/log-text.ts` instead of matching the message alone.
- Mark the steps of every test body with one-line comments, exactly `// Arrange`, `// Act` and `// Assert`, in that order, so a reader sees where the setup ends and what is checked. Leave out `// Arrange` when there is nothing to set up, and write `// Act & Assert` when the call sits inside the `expect`. Any other comment goes on its own line below a marker. These markers are an exception to the rule that comments say only why. New test files follow this now; existing files get the markers when their module's tests are reworked (harden-test-suite 5.4 for building, the full check for the rest).
- Coverage below `coverageThreshold` in `jest.config.js` fails `npm test`.
