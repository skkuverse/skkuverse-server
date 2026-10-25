---
title: Perimeter Ports — Access Decisions Behind Public Interfaces
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-26
audience: public
---

# 0023. Perimeter Ports — Access Decisions Behind Public Interfaces

> The code that decides who may call this API, how often, from which origin and to which outbound hosts sits behind eight ports in `src/perimeter/perimeter.ports.ts`. This repository holds the ports, the route bindings, a mode switch, local-development implementations and contract suites; production implementations are supplied at build time and are not part of it. Read this before you add a route that needs authentication, a limit, an internal caller, a push sender check, a CORS origin or an outbound call.

## Status

Accepted 2026-10-26, when every call site asked its port (roadmap 2A-4 (a)). Since 2A-4 (b) the production implementations are no longer in this repository: the build that supplies the overlay copies them in, as the entry D4 loads. [Changes during implementation](#changes-during-implementation) records where the build departed from the first draft.

## Context

- Access decisions were spread over HTTP middleware, `src/infra/` helpers and controllers: token verification, limiter keying, internal caller checks, push sender checks, the CORS origin list and the outbound address checks for the attachment proxy. A feature reached each of them through a different kind of import.
- This repository is meant to be public. A reader of the public code should get the shapes of these decisions, not the production policy behind them: the policy can change without a release of this code, and it is the part an attacker tunes against.
- Security must not depend on that policy staying unread. Each production implementation is reviewed on its own, and the parts a client can observe (status codes, `Retry-After`, CORS headers) stay observable.
- Config already fails fast ([0004](0004-strict-config-pre-deploy-dry-load.md)): a missing required value stops the boot and the pre-deploy dry-load. A build that silently ran without its access policy would break that rule in the worst place.

## Decision

A path written `perimeter/…` is under `src/`.

### D1. Eight ports, one file

`src/perimeter/perimeter.ports.ts` declares each port as an abstract class, which is also its Nest injection token ([0010](0010-server-architecture.md), D1: an abstract class token when a role has more than one real implementation). The upper-case names are the ports' names in docs and error messages (`PORT_LABELS`).

| Port | Decides | Called by |
| --- | --- | --- |
| `REQUEST_AUTHENTICATOR` | Whether a request carries a principal: anonymous, a user, or rejected | The authentication middleware, before any limiter |
| `RATE_LIMIT_POLICY` | The handler for a rate-limit class (`general`, `notices`, `notices-overview`) | The limiter middleware classes and their route bindings |
| `INTERNAL_AUTHORIZER` | Whether a caller may use an internal scope | `InternalScopeGuard`, bound with the scope by a handler's `@InternalRoute(…)` |
| `MINIAPP_PUSH_AUTHORIZER`, `MINIAPP_PUSH_QUOTA` | Whether a call may send or read as the mini app in its path, and whether a send fits the configured quota | The push sender service (`src/miniapps/sender/`), for every push route |
| `PUSH_CONTENT_POLICY` | Whether a push draft may be stored and sent | The push sender service |
| `ORIGIN_TRUST` | Whether a browser origin may read responses (CORS) | `bootstrapHttpApp` |
| `OUTBOUND_POLICY` | Whether the server may fetch a URL for a purpose, and how the request is made | The attachment proxy |
| `ABUSE_SIGNALS` | Where security-relevant events go | Nothing yet |

Port 4 has two tokens, so there are nine. A port takes a request view (`PerimeterRequest`: method, request target as received, IP, a header reader), never an Express request, so an implementation can be tested without a server. `RATE_LIMIT_POLICY` is the deliberate exception: it returns an Express handler, so a limiter stays an ordinary library middleware. What stays public around each port: the middleware and guard bindings, the principal and decision types, the scope and class names, the 401, 403 and 429 response shapes, the push draft type and its 400 shape, the outbound purpose enum, and the `/app/config` wire with the first-party origin tables it serves.

The ports change together with `PERIMETER_PORTS_VERSION`. Once an overlay has been built against the ports, any change to `perimeter.ports.ts` increments it, removing a scope or a class name included.

### D2. A required mode, with no default

`PERIMETER_MODE` chooses where every implementation comes from. It has no default, and like `NODE_ENV`, `ROLE` and `PORT` it is set per execution context, never in a rendered `.env`.

| Mode | Implementations | Set by |
| --- | --- | --- |
| `overlay` | The production implementations, loaded from one opaque entry built into the image | The compose files, production and `verify:serve` |
| `local-dev` | The public `LocalDev…` classes in `perimeter/local-dev/` | `npm run dev` |
| `test` | None: each token resolves to a stub that throws on first use and names its port | `jest.setup.ts` |

`local-dev` is not a weaker copy of production. Its authenticator verifies Firebase ID tokens against the public project id, through a Firebase app of its own, and keeps no cache or trust rules. Each rate-limit class gets its own limiter, built on the same limiter library, at one fixed per-IP limit, so a route bound to two classes counts once in each. Internal scopes and push senders are allowed. CORS trusts `http://localhost` and `http://127.0.0.1` origins only. The outbound policy allows an http or https URL on any host but keeps the address checks of `src/shared/outbound-guard.util.ts`: no loopback, private or link-local address, as a literal, a DNS answer or a redirect hop. Each class logs a banner at construction saying the perimeter is not the production one. A filter on every route refuses a request that came through a proxy, names a non-loopback host or was sent by another site's page: one carrying `Forwarded`, any `X-Forwarded-*`, `X-Real-IP`, `Via` or `CF-Connecting-IP`, a `Host` other than a loopback name, an `Origin` other than an http or https loopback origin, or, without an `Origin`, `Sec-Fetch-Site: cross-site`. A tunnel, a rebinding DNS name or a website's simple POST cannot reach a `local-dev` server.

A required `HOST` joins the mode: the server listens on `config.host`, not on every interface. Development uses a loopback address and the containers `0.0.0.0`, so container health checks call `127.0.0.1`.

### D3. The mode check

`perimeter/perimeter-mode.rules.ts` imports nothing from `src/infra/`. It runs in two layers:

- **At import of `src/infra/config.ts`** (the boot and the pre-deploy dry-load), string checks only: a missing or unknown `PERIMETER_MODE`; `local-dev` unless `NODE_ENV` is set to `development` explicitly, or with a `HOST` that is not a loopback address; `test` unless `NODE_ENV=test`; a missing `HOST` where the process listens; in `overlay`, an entry that does not resolve. Nothing is loaded: `config.ts` runs before the error reporter starts.
- **In `validateEnv()`** (the Nest bootstrap, `ConfigModule`, and the pre-deploy dry-load, which runs it after loading `config`), the full check in `overlay` mode: the entry loads; its `portsVersion` equals `PERIMETER_PORTS_VERSION`; every port has a class whose prototype extends the port; and the entry's `settingsErrors()` accepts the configured settings sections. Under `NODE_ENV=test` the perimeter check still runs, before the early return for missing values.

There is no override. The boot line logs the mode, and in `overlay` mode the overlay's build identity.

### D4. One opaque overlay entry

An implementation set is a `PerimeterClasses` record: one class per port, each constructed with `PerimeterDeps` (a logger, a clock, the host, `null` on the poller, which listens on nothing, the Firebase project id, the internal tokens by scope, shared counters and the settings sections). Every role constructs every class, the poller included, so a constructor reads only the logger, the clock, the host and the settings, and never a token. An overlay exports `{ portsVersion, classes, settingsErrors }` from a single entry, `perimeter.overlay`. It imports this repository's ports file, packages and the `src/shared/` modules `eslint.config.js` lists for `boundaries/perimeter-implementations` (`PERIMETER_SHARED_MODULES`: the link and mini-app target checks, the outbound address guard, the log throttle), nothing else from this repository, and constructing a class has no side effects beyond its own state. A file in an implementation set is named by the port it implements (`request-authenticator.ts`), as a `src/infra/` file is named by its resource.

Three root files of `src/perimeter/` construct implementations, and nothing else does. `perimeter-registry.rules.ts` chooses the classes per mode: the entry's in `overlay` mode, `local-dev/` in `local-dev` mode, and in `test` mode a stub per port that throws on first use and names the port. `perimeter.config.ts` builds `PerimeterDeps` and the providers: one provider loads the mode's classes once per process, and one provider per port constructs its class once. `perimeter-overlay.rules.ts` loads the entry with one `require` of `OVERLAY_ENTRY`, a path built from that file's directory, the single exception to the ban on `require()` in `src/` ([0010](0010-server-architecture.md), D9). `PerimeterModule` (`@Global()`) registers those providers; `AppModule` imports it first and `buildTestApp` adds it to every test app. The build empties `dist/` first, so an entry left from an earlier build cannot load. `OVERLAY_ENTRY` names `private/perimeter.overlay` under `src/`, a gitignored folder the image build fills from a named build context; nothing in the repository imports it.

Configured numbers reach the implementations as settings sections: every set variable whose name matches `PERIMETER_SETTINGS_RE` (`PERIMETER_SETTINGS`, then `_` and an upper-case word, any number of times), each one base64url-encoded JSON value, handed over as one name-to-value record (`PerimeterDeps.settings`, built by `perimeterSettingsOf`). The entry's one `settingsErrors(sections)` validates every section it reads for the mode check, naming the variable in each error, and each implementation parses the section it needs. Each section is strict on its own; a section the overlay reads that is missing fails the boot, with no default; a section it does not read is ignored. A new kind of number is a new section, never a key added to one: an image refuses any change to a section it reads, and the image a failed deploy re-tags against the new `.env` ignores the new one. This build reads two: `PERIMETER_SETTINGS`, the rate limits, whose shape the image deployed before 2A-3 also reads and must stay as it is, and `PERIMETER_SETTINGS_QUOTAS`, the push quotas. `src/infra/required-env.ts` names each section the overlay reads, one by one, rather than the pattern, so `render_env.py`'s list and the env manifest stay exact. Base64url, because no quoting layer between Doppler, the rendered `.env` and the container can change it. The units and keys inside a section are not part of this repository. The shared counters (`PerimeterCounters.increment(key, windowSeconds)`, answering the count and a `release` that takes that one count back from the same window, so a refused send spends nothing) count across every process for low-volume quotas, one upserted document per key and window in `perimeter_counters`, expired by a TTL index created only where pollers run ([0012](0012-runtime-roles.md), D3); they are never written once per request.

### D5. CORS before dependency injection

`bootstrapHttpApp` mounts helmet, request logging, the JSON body parser and the language middleware on the Express instance before Nest exists. CORS is applied after `create` returns, when every provider is already constructed, so the bootstrap reads `ORIGIN_TRUST` from the application container and hands the CORS middleware an origin callback. A request without an `Origin` header never reaches the port. A refused origin, or a port that throws, gets the same answer as before: `Vary: Origin` and no `Access-Control-Allow-Origin`, a preflight still `204`; a throw is logged. No perimeter code runs before the container exists.

### D6. Signed calls

A signed call is checked against what the caller sent. The request target is the URL as received, so the reverse proxy in front must pass the URI through unchanged. The raw body is captured only on the route paths a feature lists (`RAW_BODY_ROUTE_PATHS`, the signed send; a GET signs the hash of no bytes, so a history read keeps none), which `bootstrapHttpApp` takes from its caller, so the shared layer names no route; every handler that reads `rawBody` is on a listed path (`raw-body-routes.test.ts`). Whether a body can be verified is `isVerifiableSignedBody`, beside `PushCall` in the ports file. A signed route refuses a body with any `Content-Encoding` (the body parser would hand over decoded bytes), and a POST whose raw body is missing is unauthenticated. The route binding refuses both for every decision signed by a key, whatever the implementation decided; a call allowed with no key, as `local-dev` allows every call, is not a signed call. The capture matches a listed path exactly, while the router also takes a trailing slash and any case: a signed sender must call the exact path (`/miniapps/<id>/notifications`, no trailing slash, lower case), or its POST arrives with no raw body and is refused with 401. The signature covers the request target as received, the query included.

### D7. Contract suites and fakes

- A contract suite per port, in `__tests__/helpers/perimeter/`, states what every implementation must do: an absent credential is anonymous, a rejected one never reaches the limiter, a class's handler is the same instance on every call, a refusal answers the public 429 body, an internal decision is a boolean, never a throw, whatever the credential, an outbound refusal is recognized by `isBlocked`, a class constructs with deps whose token reader throws, and a push decision is well formed, never a throw, for any sender. The signed-route refusals of D6 are the binding's, tested at the route. The local-dev classes and the production implementations run the same suites. Behavior that is policy is tested only beside the implementation that holds it.
- A route test injects each port it reaches as a fake, `__tests__/helpers/fakes/perimeter/<port>.fake.ts`, through `buildTestApp`'s overrides. With no fake, the `test` stub fails the test and names the port. `RATE_LIMIT_POLICY` is the one default: every limited route reaches it, so `buildTestApp` passes a `FakeRateLimitPolicy` unless the overrides name the port, and a test that reads the counts, principals or refusals passes its own.

### D8. Boundaries, enforced

- `src/perimeter/` is a shared layer and imports no feature module (ESLint `boundaries/perimeter-layer`). Feature code and `src/http/` import only `perimeter.ports`; only `src/perimeter/` imports `local-dev/` or the overlay; nothing imports the overlay statically (`boundaries/perimeter`, `boundaries/http` and the feature blocks; `eslint-syntax.test.ts` pins the one `require`).
- An implementation imports only the ports file, the listed `src/shared/` modules, its own folder and packages (`boundaries/perimeter-implementations`), so the overlay can build against those alone.
- Every port has a fake, a contract suite and a `LocalDev…` class (`perimeter-ports.test.ts`).
- Every handler under `internal/` carries `@InternalRoute(…)`, which sets its scope and binds `InternalScopeGuard` (`internal-scopes.test.ts`).
- Outside `src/perimeter/`, no file calls `rateLimit(`, `verifyIdToken` or a constant-time token comparison (`perimeter/calls`).
- `.ports` joins the closed role vocabulary of [0010](0010-server-architecture.md), D4, for `src/perimeter/perimeter.ports.ts` alone.

## Changes during implementation

Where the build departed from the first draft, and why. None changes what production answers.

| Change | Why |
| --- | --- |
| The registry is three root files (D4), not one `perimeter.registry.ts`, and the draft's `perimeter.mode-check.ts` is two, `perimeter-mode.rules.ts` and `perimeter-overlay.rules.ts` | A root file in `src/` takes a role from the vocabulary: the class choice and the loader are `.rules`, the provider list a `.config`, and a `.module` is capped at a few lines |
| One provider loads the mode's classes once per process | Each port's provider loaded and shape-checked the entry again, nine loads in `overlay` mode |
| `boundaries/module-loads` keeps its ignores, and the one `require` carries one inline disable | Two assertions pin those ignores; `eslint-syntax.test.ts` pins that the disable and the `require` are the only ones in `src/` |
| `PerimeterDeps.host` is `null` on the poller, not an empty string | Every reader had to know that `""` meant "listens on nothing" |
| `PERIMETER_MODE=test` needs `NODE_ENV=test`, as `local-dev` needs `development` | A development process with the test stubs booted with no perimeter at all |
| The outbound address guard and the log throttle moved to `src/shared/` | `local-dev` keeps the address checks (no loopback, private or link-local fetch), and an implementation keeps its throttled warning, without importing `src/infra/` |
| The signed-body refusals of D6 are the route binding's (`toPushRefusal`, `src/miniapps/sender/`), only for a decision signed by a key | In the implementations they would have refused unsigned calls that production answers today, such as an encoded body with the shared token |
| The raw body is captured on the paths a feature lists (`RAW_BODY_ROUTE_PATHS`), passed to `bootstrapHttpApp` | A route regex in `src/http/` made a shared layer name a feature route |
| The push sender service (`src/miniapps/sender/`) holds the three push ports | It keeps every perimeter decision about a sender in one sub-module the 2A-3 public route can import |
| `@InternalRoute(scope)` replaces a scope decorator plus `@UseGuards`, and `guard` joins the role vocabulary | One decorator cannot be half applied |
| Until 2A-3, `INTERNAL_AUTHORIZER` checked the shared push token under `miniapps.push`, and both push authorizers allowed every call with no key. Since 2A-3 the production authorizer verifies signed calls only. For one release the internal routes took the trusted path (`authorizeTrusted`) after the token; 2A-3 deploy 2 removed them with the `miniapps.push` scope ([0020](0020-miniapp-push-link-policy.md), D6) | Production kept answering the push console as before until it was retired, and the shared token never opened a public route, which the edge does not block as it will `/internal/*` |
| 2A-3 made the settings a record of sections (`PERIMETER_SETTINGS_RE`), with one `settingsErrors(sections)`, and put the push quotas in `PERIMETER_SETTINGS_QUOTAS`, not in `PERIMETER_SETTINGS` | The image a failed deploy re-tags refuses any change to the shape of `PERIMETER_SETTINGS` and ignores a variable it does not read; one mechanism, so a later kind of number needs no new deps field, export or check |
| `buildTestApp` passes `FakeRateLimitPolicy` unless a test names the port (D7); it also flags an `Origin` sent without `FakeOriginTrust` when the app closes | Every limited route reaches the policy, and the first form, an override in every route test, changed 61 files that never read it; a refusal by the throwing CORS stub is silent |
| The `local-dev` limiter counts each class on its own (D2) | `/notices/overview` passes two classes and was counted twice against one bucket |
| The contract suites hold less than drafted: no "a refused internal call is false", no promised quota refusal | `local-dev` allows every internal call, and neither implementation refuses a send yet; a refusal is policy, tested beside the implementation that holds it |
| `PERIMETER_PORTS_VERSION` stayed 1 through every ports change, the removal of the `miniapps.push` scope included | No overlay had been built against the ports yet |
| Without the overlay, Jest maps `OVERLAY_ENTRY` to a stand-in entry under `__tests__/helpers/perimeter/` (`jest.config.js`): one empty subclass per LocalDev class and a settings check that accepts any sections. A public case asserts only what holds for every valid overlay; the overlay's own specs hold its policy | The registry and the mode check have `overlay`-mode cases, and `overlayResolveErrors()` calls `require.resolve`, which a virtual Jest mock does not serve |
| The image build takes the overlay from one compose file with an interpolated named context, `${PERIMETER_OVERLAY_DIR:-./perimeter-overlay.empty}`, not a second compose file. The Dockerfile has no stage of that name, so a plain build without the context fails | A build that forgets the variable gets the empty folder, whose image refuses `overlay` mode at the pre-deploy dry-load; a fallback stage let a plain build reuse a cached overlay |
| The image carries its overlay commit, `PERIMETER_OVERLAY_SHA` (`none` without one), as an `ENV`, a label, `config.perimeter.overlayBuild` in both boot lines and a Sentry tag; the Sentry release stays the server commit | A deploy and a rollback can tell which overlay an image holds, and the release history stays as it was |

## Options considered

| Option | Verdict |
| --- | --- |
| A public default implementation that denies by default | Rejected: it would still be a policy to read and maintain, and a build that lost its production implementations would run on it unnoticed |
| An interface plus a string or Symbol token per port | Rejected: [0010](0010-server-architecture.md), D1 uses an abstract class as the token |
| Loading the overlay in `config.ts`, so its first import refuses everything | Rejected: `config.ts` runs before the error reporter starts and is imported by modules the overlay may reach; the string checks there and the full load in `validateEnv()` refuse the same images |
| Resolving `ORIGIN_TRUST` before Nest, outside the container | Rejected: CORS is applied after `create` already, so the container instance serves it with no second construction path |
| Conditional package imports (`#perimeter` with a custom condition) instead of one `require` | Runner-up: static imports and no `require` exception, but every entry point, Jest and knip need the condition configured |
| Implementations reading config and the logger directly | Rejected: an implementation would import half of `src/infra/`, and the mode check could not load it without side effects |

## Consequences

- A process without a mode, or in `overlay` mode without a matching entry, does not start; the dry-load fails before any container changes.
- An outsider runs the server with `PERIMETER_MODE=local-dev` on a loopback address and sees the banner; nothing it runs resembles the production policy. Reaching a laptop server from a phone on the LAN or through a tunnel needs the `overlay` mode.
- Route tests name the ports they reach. A route that starts calling a port fails its tests until a fake is added.
- Every port change spans this repository and the implementations; `PERIMETER_PORTS_VERSION` turns a mismatch into a boot failure instead of a runtime error.
- The `RATE_LIMIT` runtime switch is removed: `local-dev` is the one development setting for the perimeter. The other runtime switches gate upstream calls and cost and stay.
