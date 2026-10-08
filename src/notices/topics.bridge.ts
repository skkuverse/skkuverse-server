/**
 * topics.bridge — the single boundary between the NestJS notices module and the
 * `./notices.topics` implementation (`buildTopics`, `TOPIC_CAP`). Everything in
 * `src/notices/` that needs topic mapping imports from HERE, never from
 * `./notices.topics` directly.
 *
 * WHY A RUNTIME REQUIRE INSTEAD OF A STATIC `import` — the original reason no
 * longer holds. `./notices.topics` statically imports `./tabConfig`, and the
 * require was there to keep tabConfig.ts out of the `tsconfig.test.json`
 * program: with `noImplicitAny: false` its untyped `const sources = []`
 * collapsed to `never[]` and failed to type-check. Both halves are gone: that
 * array is now typed, and tabconfig.service.ts imports tabConfig.ts statically,
 * so the test program includes and type-checks it anyway. A static import of
 * `./notices.topics` here would type-check under both tsconfigs; the require
 * keeps nothing out.
 *
 * The require result is bound to LOCAL, precise types that mirror the real
 * `notices.topics` exports — NOT `any`. A shape/signature mismatch (e.g. the
 * module renaming an export) surfaces as a runtime `undefined`/TypeError at
 * first use rather than being silently swallowed: there is no `?? []` or
 * defensive narrowing here (keeps notices.topics' fail-loud contract).
 * Runtime behavior is byte-identical to importing notices.topics
 * directly — same function object, same TOPIC_CAP value.
 */

// Mirrors notices.topics.ts `buildTopics` and the
// NoticeForTopic param it reads (only `sourceId` is consumed).
type BuildTopics = (
  noticeDoc: { sourceId?: string } | null | undefined,
) => string[];

interface NoticesTopicsModule {
  buildTopics: BuildTopics;
  TOPIC_CAP: number;
}

const topicsModule = require("./notices.topics") as NoticesTopicsModule;

export const buildTopics: BuildTopics = topicsModule.buildTopics;
export const TOPIC_CAP: number = topicsModule.TOPIC_CAP;
