---
paths:
  - "__tests__/**"
  - "jest.config.js"
  - "jest.setup.ts"
---

# Test conventions

- A test for `src/<module>/` lives in `__tests__/nest/<module>/`. `__tests__/helpers/` is shared infrastructure, excluded from collection and coverage (`jest.config.js`).
- Route tests build an app with `__tests__/helpers/nest/build-<module>-app.ts` (ad, building, bus, map, notices, ui). Each builder copies the `src/main.ts` pipeline by hand (request logging, JSON body, `LangMiddleware`, `ResponseInterceptor`, `HttpExceptionFilter`) and takes `{ provide, useValue }` overrides. Stub every service whose `onModuleInit` reaches Mongo, or app init hangs.
- No test reaches MongoDB or an external API. Mock modules with `jest.mock()` (common targets: `src/infra/logger`, `src/infra/db`, `axios`, `src/common/fcm-client`).
- `jest.setup.ts` gives every required env var a dummy value when unset. A new required var needs an entry there too.
- Jest runs with `NODE_ENV=test`: DB names get `_test`, and missing config does not exit.
- ts-jest only transpiles (`diagnostics: false`, lax `tsconfig.test.json`). Run `npm run typecheck` to catch type errors in tests.
- Assert on logged fields with `__tests__/helpers/log-text.ts` instead of matching the message alone.
- Coverage below `coverageThreshold` in `jest.config.js` fails `npm test`.
