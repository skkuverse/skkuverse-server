/**
 * Fails every test file at once, naming the flag, when Jest runs without
 * Node's --experimental-vm-modules. Jest loads modules itself, so the ESM-only
 * packages in node_modules (NestJS 12, @nestjs/config 12) load only through its
 * vm-modules loader; without the flag each suite would die on a bare
 * "Cannot use import statement outside a module" instead.
 *
 * The flag is what defines `vm.SourceTextModule`. This sits in `setupFiles`, not
 * in jest.config.js, because knip loads that file without the flag.
 */
import vm from "node:vm";

if (typeof vm.SourceTextModule !== "function") {
  throw new Error(
    "Jest needs Node's --experimental-vm-modules flag to load ESM-only packages. " +
      "Run `npm test` (its script sets the flag), or for one file: " +
      "NODE_OPTIONS=--experimental-vm-modules npx jest <file>",
  );
}
