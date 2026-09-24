/**
 * The api replicas are named in two files here, and a replica missing from
 * either fails quietly:
 *
 *   - docker-compose.yml runs it, and the deploy rolls what it lists;
 *   - docker-compose.local-verify.yml points it at _dev databases (missing:
 *     `npm run verify:serve` boots it against PRODUCTION data).
 *
 * The deploy reads the replicas from docker-compose.yml by the shape pinned
 * below, and the host's nginx upstream, which sends each replica traffic and is
 * configured outside this repository, balances exactly the map below.
 *
 * This requires the two files to name the same set, and pins every ROLE a
 * compose file sets to the roles the server boots with. The files are parsed
 * with patterns rather than a YAML parser: their shape is fixed and the repo
 * avoids a dependency for it.
 */
import fs from "fs";
import path from "path";
import { ROLES } from "../../../src/infra/required-env";

const root = path.join(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const compose = read("docker-compose.yml");
const verify = read("docker-compose.local-verify.yml");

/** Service blocks: two-space-indented keys under `services:`. */
function serviceBlocks(yaml: string): Map<string, string> {
  const services = yaml.slice(yaml.indexOf("\nservices:\n"));
  const blocks = new Map<string, string>();
  const re = /^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\n)*)/gm;
  for (const m of services.matchAll(re)) blocks.set(m[1]!, m[2]!);
  return blocks;
}

/** A loopback port mapping anywhere on a line, as the deploy finds it. */
const MAPPING = /"127\.0\.0\.1:(\d+):3000"/;
/** The one shape such a line may have here. */
const ANCHORED = /^ {6}- "127\.0\.0\.1:\d+:3000"$/;

/** api-N service → every non-comment line of its block that maps a loopback port, from docker-compose.yml. */
const replicaMappings = new Map(
  [...serviceBlocks(compose)]
    .filter(([name]) => /^api-\d+$/.test(name))
    .map(([name, block]) => [name, block.split("\n").filter((line) => !/^\s*#/.test(line) && MAPPING.test(line))] as const),
);
const portOf = (line: string) => Number(MAPPING.exec(line)![1]);

describe("api replica topology", () => {
  // WHY: the deploy rolls each `api-N` under `services:` on the port of its one
  // "127.0.0.1:<port>:3000" mapping, and aborts on none, two, or a shared port.
  it("each replica maps exactly one loopback port, on its own line, on a port no other replica uses", () => {
    // Act
    const lines = [...replicaMappings];

    // Assert
    expect(lines.filter(([, mapped]) => mapped.length !== 1).map(([name]) => name)).toEqual([]);
    expect(lines.filter(([, mapped]) => !ANCHORED.test(mapped[0]!)).map(([name]) => name)).toEqual([]);
    expect(new Set(lines.map(([, mapped]) => portOf(mapped[0]!))).size).toBe(lines.length);
  });

  // WHY: the host's nginx upstream, configured and tested outside this repository, balances across
  // exactly these ports; change both together.
  it("runs exactly the replicas the host's nginx upstream balances", () => {
    // Assert
    expect(Object.fromEntries([...replicaMappings].map(([name, mapped]) => [name, mapped.map(portOf)]))).toEqual({
      "api-1": [3001],
      "api-2": [3002],
      "api-3": [3003],
    });
  });

  it("local verify points every replica at _dev databases", () => {
    // Act
    const blocks = serviceBlocks(verify);

    // Assert
    for (const name of replicaMappings.keys()) {
      expect(blocks.has(name)).toBe(true);
      expect(blocks.get(name)).toMatch(/environment: \*api-dev-env/);
    }
    // The shared list itself must rename every database the api writes.
    const env = verify.match(/x-api-dev-env: &api-dev-env\n((?: {2}- .*\n)+)/);
    expect(env).not.toBeNull();
    for (const key of [
      "MONGO_DB_NAME_BUS_CAMPUS",
      "MONGO_BUILDING_DB_NAME",
      "MONGO_NOTICES_DB_NAME",
      "MONGO_EVENTMAP_DB_NAME",
      "MONGO_MINIAPPS_DB_NAME",
    ]) {
      expect(env![1]).toMatch(new RegExp(`- ${key}=\\w+_dev\\n`));
    }
  });

  // The api reads the datasets; a later stage may write them from the poller.
  it("local verify points the api replicas and the poller at the _dev content database", () => {
    // Arrange
    const apiEnv = verify.match(/x-api-dev-env: &api-dev-env\n((?: {2}- .*\n)+)/)?.[1];
    const pollerEnv = serviceBlocks(verify).get("poller");

    // Act & Assert
    expect(apiEnv).toMatch(/- MONGO_CONTENT_DB_NAME=skku_content_dev\n/);
    expect(pollerEnv).toMatch(/- MONGO_CONTENT_DB_NAME=skku_content_dev\n/);
  });
});

describe("compose ROLE values", () => {
  it.each(["docker-compose.yml", "docker-compose.local-verify.yml"])(
    "%s sets ROLE only to a role the server boots with",
    (rel) => {
      // Act
      const roles = [...read(rel).matchAll(/\bROLE\s*[=:]\s*"?([^\s"]*)/g)].map((m) => m[1]!);

      // Assert
      expect(roles.length).toBeGreaterThan(0);
      for (const role of roles) expect(ROLES).toContain(role);
    },
  );
});
