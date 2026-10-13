---
paths:
  - "__tests__/**"
  - "src/**/*.spec.ts"
  - "contracts/produced/fixtures/**"
  - "jest.config.js"
  - "jest.setup.ts"
---

# Test conventions

ADR 0011 (`docs/decisions/0011-test-strategy.md`) is the decision and its why; `src/building/` is the template module. A rule below that names a test is enforced by it. Never edit, skip or delete an existing test, a floor or an allowlist entry to get green: if a test looks wrong, stop and tell the user.

## Write a test first

1. Pick the level from ADR 0011 D1: unit (`src/**/<name>.spec.ts`), boundary (a repository or client spec), route (`__tests__/nest/<module>/*.routes.test.ts`), structural (`__tests__/architecture/`, `__tests__/contracts/`, `__tests__/nest/{config,infra}/`).
2. Write the test from the requested behavior, not from the implementation.
3. Run it and watch it fail for the expected reason, on its assertion, not on an import or a `TypeError`.
4. Implement without editing that test.
5. If the test looks wrong, stop and say so instead of changing it.

- A test written against code that already works passes on its first run, which proves nothing. Make one or two hand mutants per seam (a dropped filter, a flipped sort, an off-by-one threshold) fail it, and list them in the commit message.
- When one session writes the test and another the code: commit the red test with `Expected-Red: <test file>, …`, in its own `describe`, and run it against a sketch of the change in a scratch worktree first. The implementing commit carries `Red-Fixed: <test file>, …` and does not touch the test file. Never add a trailer to get past a blocked Stop.
- Characterization tests are never edited while the refactor runs; a failure is a regression to report.

## Where a test lives

- A unit test sits next to its source as `src/<path>/<name>.spec.ts`. Specs are type-checked by `npm run typecheck` (`tsconfig.json`) and left out of the build (a compiled spec in `dist/` fails it), of coverage and of the size caps. An unmigrated module's unit tests stay in `__tests__/nest/<module>/` until its migration moves them.
- (An operations detail is left out of the public history.)
- `__tests__/helpers/` is shared infrastructure, never collected or counted in coverage. `__tests__/architecture/` holds the architecture rules.
- Each role has one kind of test (ADR 0011 D1): `.rules` table-driven at each threshold (one below, at, one above); `.mapper` input → output with optional fields missing; `.schema` a captured document passes and a copy missing each `schema.shape` field fails; `.query` a structure pin, marked as such in its header; `.client` captured fixtures; `.service` over fakes; `.poller` registration and a rejecting failure; no spec for a controller or module.
- In a migrated scope every `.service.ts` has its `.service.spec.ts`, unless it only delegates; then it is listed in `__tests__/architecture/exemptions/service-specs.json` with the reason, which review reads (`service-specs`). An exemption is not an allowlist: allowlists record unmigrated debt and only shrink, and a migrated scope carries none (`migrated-scopes`); an exemption is a decision that holds there, so it sits apart in `exemptions/` as `{ "<path>": "<reason>" }`, keys sorted, each reason a sentence (at least 40 characters and 6 words). An entry whose file stops violating fails until deleted.

## What to double

- Double only what leaves the process (MongoDB, HTTP, FCM, the clock), by role:
  - a repository: a typed in-memory fake
  - a client: a scripted fake in the service's spec, plus a spec of the client itself over captured fixtures
  - a poller: a spy on the poller registry
  - the time: inject `Clock` (`src/infra/clock.ts`) and override it with `{ provide: Clock, useValue: fakeClock }`, or pass a fixed `{ now: () => NOW }` to a constructor; a spec in a migrated scope never constructs the real `Clock` (ESLint `specs/fixed-clock`). Pure code takes the time as an argument. Don't spy on `Date.now`.
  - a module without a repository (`app-config`, `health`): no fake; the route test covers it
- `jest.mock` of `src/infra/db` or `src/infra/mongo` (the Mongo seam, which repositories open collections through) belongs only in a repository spec, of `axios` only in a client spec, and so does a `jest.spyOn` of a repository's or client's prototype; the seams' own specs may mock what they wrap. A service spec uses fakes. Checked by `spec-mocks` in migrated scopes; a test with no fake to use instead is exempt with its reason in `exemptions/spec-mocks.json`. Mocking `src/infra/logger` is fine anywhere. Unmigrated modules keep their module mocks until their rework.
- A fake is `class Fake<Name> implements PublicOf<<Name>>` in `__tests__/helpers/fakes/<module>/<name>.<role>.fake.ts`, passed to a constructor with `asReal<T>(fake)` (`__tests__/helpers/fakes/public-of.ts`). Checked by `fake-shape`. It applies the real read's filter, projection and sort, and the repository spec pins that query object, so a change to one shows in the other: in a migrated scope, each public read of a repository is called in a test of its spec that asserts on a stub's calls (`repository-pins`).
- Assert the returned value, the response or the fake's final state. Assert a call (`toHaveBeenCalled*`) only when the call is the behavior (one FCM send per notice, one AI call per cache window) or for an argument the response cannot show.

## Route tests

- Boot the app with `buildTestApp({ imports, overrides, role })` (`__tests__/helpers/nest/build-test-app.ts`). It runs the production pipeline (`bootstrapHttpApp`, `src/http/http-app.bootstrap.ts`) and listens on `127.0.0.1`. List `imports` in `src/app.module.ts` order. The `build-<module>-app.ts` builders are legacy: don't add one, and move a module off its builder with its refactor group.
- Override only repositories, clients, pollers, the poller registry and `Clock`, each with one fake. Checked by `route-overrides`. Override every provider whose `onModuleInit` reaches Mongo, or app init hangs; in a migrated module that is a repository.
- Assert the status, the envelope, the error `code` and `message`, and the headers.
- A route that serves a wire type may also assert `expectWire(schema, data)` (`__tests__/helpers/contracts/expect-wire.ts`) on the envelope's `data` or `meta`. Add it as a new assertion, never as an edit to a frozen one.

## Determinism

- No test reaches MongoDB or the network. `__tests__/helpers/network-guard.ts` fails a connection, DNS lookup or `fetch` to anything but loopback, naming the host; stub `global.fetch` and restore it in `afterAll`. A server listens on `127.0.0.1` only: the guard refuses any other bind. Serve a bare Express app through `LoopbackServers` (`__tests__/helpers/nest/loopback-servers.ts`), never by handing it to supertest. A test that expects a refusal takes it with `takeBlockedConnections()`. Checked by `__tests__/nest/infra/network-guard.test.ts`.
- Tests run in UTC (`jest.config.js`; checked by `__tests__/nest/infra/test-timezone.test.ts`). Test KST date logic at an instant where UTC and KST fall on different dates (`2026-10-19T16:30:00Z` is 01:30 KST on the 20th), and assert both the KST answer and that the UTC one is not returned (`__tests__/nest/notices/notices-dispatcher.service.test.ts`).
- Change shared mutable config (a `serviceConfig` entry, an env var) only inside `try/finally`. A spec that turns on fake timers restores real ones in `afterEach`.
- Jest runs with `NODE_ENV=test`: DB names get `_test`, and missing config does not exit. `jest.setup.ts` gives every required env var a dummy value when unset; a new required var needs an entry there too.

## Fixtures and contracts

- Every JSON file under a `fixtures/` folder is an object with an `_about` string: the source (endpoint and parameters), the `YYYY-MM-DD` capture date and what was trimmed, or "Synthetic" (or "Hand-written") and why it was never captured. No user data. Checked by `fixture-provenance`.
- A client fixture is a captured, trimmed response in `__tests__/nest/<module>/fixtures/`; `__tests__/nest/bus/naver-directions.test.ts` is the model.
- A test input that disagrees with the real payload is fixed in the test, never by widening production code.
- `contracts/produced/` is generated from the `.wire` files: rerun `npm run contracts:export` after changing one. Each fixture in `contracts/produced/fixtures/<id>/` is `{ "_about": …, "data": … }`, parses, and holds only declared properties. Checked by `__tests__/contracts/`.

## The shape of a spec

- Open each test file with a docblock saying which behavior it guards (`src/building/building.repository.spec.ts`).
- Mark the steps of every test body with one-line comments, exactly `// Arrange`, `// Act` and `// Assert`, in that order. Leave out `// Arrange` when there is nothing to set up, and `// Act` when the act ran in a shared setup or there is none; write `// Act & Assert` when the call sits inside the `expect`. Any other comment goes on its own line below a marker. Checked by `test-hygiene`; files that predate the rule are in its `test-aaa.json` allowlist, and a new file complies from its first commit.
- Name a sibling spec's top-level `describe` after what the source next to it exports: the function, `@Decorator` or `Class.method` (`BuildingRepository.listBuildings`), never a wrapper the spec defines. A title that opens with a code name the source does not export fails `spec-titles`; one that opens in prose is not checked.
- Every other comment says only why, as in `src/` (ADR 0010 D10). The three-line cap and the `comment-tags` prefixes do not apply to tests.
- Assert on logged fields with `__tests__/helpers/log-text.ts` instead of matching the message alone.

## Guards on the suite

- `test-hygiene`: no `.only`, `fit`, `fdescribe`, `.skip`, `xit`, `xdescribe` or `.todo`, and every test body asserts.
- `test-floors`: a module's test and `expect(` counts never drop below `__tests__/architecture/test-floors.json`. Delete a spec only in the commit that deletes the code it tests, and lower the floor in that diff; a rise passes (`TEST_FLOORS_WRITE=1` regenerates the file).
- Coverage below `coverageThreshold` in `jest.config.js` fails `npm test`.
- ts-jest only transpiles: run `npm run typecheck` to catch type errors in tests.
