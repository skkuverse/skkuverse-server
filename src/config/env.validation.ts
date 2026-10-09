/**
 * Nest-native fail-loud env validation.
 *
 * Importing src/infra/config.ts already exits the process (outside test) when
 * a required value is missing. The Nest bootstrap must throw instead of
 * relying on an imported module's process.exit, so it checks the same list:
 * both read src/infra/required-env.ts. Test mode (NODE_ENV=test) skips the
 * throw, as config.ts skips its exit.
 */
import { envMode, missingRequired } from "../infra/required-env";
import { resolveRuntimeSwitches, runtimeMode } from "../infra/runtime-switches";

/** Missing required values as `  name (env: VAR)` lines. */
export function findMissingRequired(): string[] {
  return missingRequired(process.env).map(({ name, env }) => `  ${name} (env: ${env})`);
}

/**
 * Called at ConfigModule construction (a provider useFactory). Throws, never
 * exits, so Nest fails the bootstrap loudly.
 */
export function validateEnv(): void {
  const { nodeEnv, isTest } = envMode(process.env);
  if (isTest) return;
  const missing = findMissingRequired();
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required config — set these env vars:\n${missing.join("\n")}`,
    );
  }
  // The same resolver config.ts exits on, so the two layers refuse the same
  // switches.
  const { errors } = resolveRuntimeSwitches(process.env, runtimeMode(nodeEnv));
  if (errors.length > 0) {
    throw new Error(`FATAL: Invalid runtime switch:\n  ${errors.join("\n  ")}`);
  }
}
