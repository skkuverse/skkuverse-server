/**
 * Serves a bare Express app (any request listener) on 127.0.0.1 at an ephemeral
 * port, for supertest. Handed the app itself, supertest would listen on every
 * address, which the network guard refuses (__tests__/helpers/network-guard.ts).
 * A Nest app listens through `app.listen(0, "127.0.0.1")` instead.
 */
import http from "node:http";

export class LoopbackServers {
  private readonly open: http.Server[] = [];

  async serve(handler: http.RequestListener): Promise<http.Server> {
    const server = http.createServer(handler);
    this.open.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    return server;
  }

  /** Closes every server `serve` opened since the last call. */
  async closeAll(): Promise<void> {
    const servers = this.open.splice(0);
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
}
