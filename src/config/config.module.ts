import { Global, Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { validateEnv } from "../infra/required-env";

function validatedEnv(env: Record<string, unknown>): Record<string, unknown> {
  validateEnv();
  return env;
}

// WHY: src/infra/config.ts loads dotenv itself (`ignoreEnvFile`), and APP_CONFIG_VALIDATION checks again while
// Nest builds the providers, so a missing variable fails the boot even if the `validate` hook stops being wired.
@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validatedEnv })],
  providers: [{ provide: "APP_CONFIG_VALIDATION", useFactory: () => { validateEnv(); return true; } }],
})
export class ConfigModule {}
