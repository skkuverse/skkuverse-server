/**
 * The one builder for route tests (ADR 0011, D4). It boots the given
 * modules through the production HTTP pipeline, `bootstrapHttpApp` in
 * src/http/http-app.bootstrap.ts, which src/main.ts also calls, so a route test
 * exercises the real middleware order, CORS, interceptor and filter rather than
 * a copy of them.
 *
 * The app listens once on 127.0.0.1 with an ephemeral port. supertest reuses a
 * listening server's address, so `request(app.getHttpServer())` binds no port
 * per request.
 */
import type { ModuleMetadata } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { bootstrapHttpApp } from "../../../src/http/http-app.bootstrap";
import { RAW_BODY_ROUTE_PATHS } from "../../../src/miniapps/notifications/miniapps-notifications.constants";
import { PerimeterModule } from "../../../src/perimeter/perimeter.module";
import { toTestStub } from "../../../src/perimeter/perimeter-registry.rules";
import { OriginTrust, RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeRateLimitPolicy } from "../fakes/perimeter/rate-limit-policy.fake";

export interface OverrideSpec {
  provide: unknown;
  useValue: unknown;
}

export interface TestAppOptions {
  /** Listed in src/app.module.ts order: routes on a shared prefix register in module-scan order. */
  imports: NonNullable<ModuleMetadata["imports"]>;
  overrides?: readonly OverrideSpec[];
  /** ROLE while the app boots and runs; the previous value comes back on `app.close()`. */
  role?: "api" | "poller" | "combined";
}

/**
 * ORIGIN_TRUST's test-mode stub, remembering what it was asked. CORS refuses an origin whose port throws (ADR 0023,
 * D5), so a route test that sends an Origin without FakeOriginTrust would see a refusal, not the stub's error; the
 * app's close fails instead, naming the fake.
 */
class UnfakedOriginTrust extends OriginTrust {
  readonly askedOrigins: string[] = [];
  private readonly stub = toTestStub("originTrust");

  isCorsOrigin(origin: string): boolean {
    this.askedOrigins.push(origin);
    return this.stub.isCorsOrigin(origin);
  }
}

export async function buildTestApp({ imports, overrides = [], role }: TestAppOptions): Promise<NestExpressApplication> {
  const restoreRole = role === undefined ? () => undefined : setRole(role);

  // The perimeter ports every route reaches, test-mode stubs unless overridden with a fake (ADR 0023, D7).
  const builder = Test.createTestingModule({ imports: [PerimeterModule, ...imports] });
  for (const o of overrides) {
    builder.overrideProvider(o.provide as never).useValue(o.useValue);
  }
  const unfakedOriginTrust = overrides.some((o) => o.provide === OriginTrust) ? undefined : new UnfakedOriginTrust();
  if (unfakedOriginTrust) builder.overrideProvider(OriginTrust).useValue(unfakedOriginTrust);
  // Every limited route reaches RATE_LIMIT_POLICY; a test that reads the counts passes its own fake.
  if (!overrides.some((o) => o.provide === RateLimitPolicy)) builder.overrideProvider(RateLimitPolicy).useValue(new FakeRateLimitPolicy());
  const moduleRef = await builder.compile();

  const app = await bootstrapHttpApp(
    (adapter, options) => moduleRef.createNestApplication<NestExpressApplication>(adapter, options),
    RAW_BODY_ROUTE_PATHS,
  );
  const close = app.close.bind(app);
  app.close = async (): Promise<void> => {
    try {
      await close();
    } finally {
      restoreRole();
    }
    if (unfakedOriginTrust && unfakedOriginTrust.askedOrigins.length > 0) {
      const asked = unfakedOriginTrust.askedOrigins.join(", ");
      throw new Error(`ORIGIN_TRUST was asked about ${asked} with no fake, so CORS refused it silently: pass FakeOriginTrust in buildTestApp's overrides`);
    }
  };

  await app.listen(0, "127.0.0.1");
  return app;
}

function setRole(role: string): () => void {
  const previous = process.env.ROLE;
  process.env.ROLE = role;
  return () => {
    if (previous === undefined) delete process.env.ROLE;
    else process.env.ROLE = previous;
  };
}
