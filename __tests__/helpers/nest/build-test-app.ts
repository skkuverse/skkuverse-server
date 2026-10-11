/**
 * The one builder for route tests (harden-test-suite D4). It boots the given
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

export async function buildTestApp({ imports, overrides = [], role }: TestAppOptions): Promise<NestExpressApplication> {
  const restoreRole = role === undefined ? () => undefined : setRole(role);

  const builder = Test.createTestingModule({ imports });
  for (const o of overrides) {
    builder.overrideProvider(o.provide as never).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();

  const app = await bootstrapHttpApp((adapter, options) =>
    moduleRef.createNestApplication<NestExpressApplication>(adapter, options),
  );
  const close = app.close.bind(app);
  app.close = async (): Promise<void> => {
    try {
      await close();
    } finally {
      restoreRole();
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
