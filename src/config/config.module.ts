import { Global, Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { validateEnv } from "./env.validation";

/**
 * @Global config module.
 *
 * - NestConfigModule.forRoot({ isGlobal, validate }) runs validateEnv() at
 *   bootstrap; the `validate` hook throws on any missing required env var
 *   (fail-loud, NestJS-native — does NOT process.exit).
 * - APP_CONFIG_VALIDATION is a belt-and-suspenders provider whose useFactory
 *   also runs validateEnv() during DI graph construction, so the crash fires
 *   even if a future refactor changes how NestConfigModule's validate is wired.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true, // src/infra/config.ts loads dotenv itself; don't double-load
      validate: (cfg: Record<string, unknown>) => {
        validateEnv();
        return cfg;
      },
    }),
  ],
  providers: [
    {
      provide: "APP_CONFIG_VALIDATION",
      useFactory: () => {
        validateEnv();
        return true;
      },
    },
  ],
})
export class ConfigModule {}
