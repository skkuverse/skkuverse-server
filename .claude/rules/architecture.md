---
paths:
  - "src/**/*.ts"
---

# Where code goes

ADR 0010 (`docs/decisions/0010-server-architecture.md`) is the decision; `src/building/` is the reference module. What a test or ESLint checks is not restated here: file roles and names, one role file per folder, sub-module direction, Mongo syntax only in repositories and `.query` files, repository return types, route order, limiter coverage, per-role size caps. This file holds the placement rules that need judgment.

## Three questions for new code

1. **Which flow is it?** An endpoint, a poller, or a step one of them takes. Code for a flow lives in that flow's folder. If the folder already has a file of the role you need (a second repository, mapper, controller or rules file), the flow is a sub-module of its own: `src/<module>/<flow>/<module>-<flow>.module.ts`, imported by `src/app.module.ts`, importing its parent. Once a module has a sub-module, its first flow moves into a folder too (`src/building/catalog/`); the root keeps the module file and the code several flows share. Do not make folders by type (`controller/`, `services/`): the explorer nesting in `.vscode/settings.json` groups a folder's files instead.
2. **Which role?** Talks HTTP: controller. Composes a use case: service. Reads or writes Mongo: repository. Builds Mongo syntax without running it: query. Calls a third party and translates its payload: client. Decides or computes: rules. Reshapes: mapper.
3. **Who already owns it?** One concept has one home. Search the module's glossary in `naming.md` and its files before adding a new name or helper.

## Rules that need judgment

- **Joins are the service's.** A repository method runs one query and returns documents or a projection of them. When a response needs two reads (a building's connections and the buildings at their far ends), the service makes both calls and a mapper puts them together.
- **An index belongs to the repository whose query it serves**, created in that repository's `onModuleInit` through `ensureIndexesAtBoot` (`src/infra/mongo.ts`). An index that guards a write (a unique key an upsert filters on) belongs to the writer.
- **Rules, mapper or query.** A rule decides or computes (`toDisplayNo`, the tier tables). A mapper reshapes without deciding (`groupByFloor`). A query writes Mongo (`tiersToScoreExpr`). When a rule must reach the database, split it: the decision stays in `.rules`, its Mongo form goes to `.query`, and a spec pins that the two agree.
- **A pure function that builds Mongo syntax is still Mongo.** A `$set`, a filter or a bulk operation belongs to the repository or a `.query`, never to a mapper.
- **Flows read the parent's repository; other features read its service.** A sub-module injects its parent's repository directly. Another feature may import only a module's `.module` and `.service` files, so a module that others read exports a service as its door, and that service may forward to the repository 1:1 (ADR 0010, D1): `BuildingService` for `map`.
- **Only the module that owns a URL prefix binds the rate limiter.** A sub-module under the same prefix binds nothing, or each request counts twice.
- **Data written outside `src/` is read tolerantly.** Project the fields you use. If it is cached, parse it with a zod schema in `.schema` that `satisfies` the document type, drop and log a bad document, and pin the writer's output against the schema in a test.
- **Characterize before moving a Mongo shape.** Pin the exact operation on today's code in a spec, then move it; the expected value must not change in the move.
