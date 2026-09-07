import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ALLOWED: Record<string, { file: string; type: string }> = {
  "/fixture-draft-room": {
    file: path.join("fixtures", "cbs", "fixture-draft-room.html"),
    type: "text/html; charset=utf-8"
  },
  "/fixture-draft-room-rich": {
    file: path.join("fixtures", "cbs", "fixture-draft-room-rich.html"),
    type: "text/html; charset=utf-8"
  },
  "/pick-35.json": {
    file: path.join("fixtures", "pick-35.json"),
    type: "application/json; charset=utf-8"
  },
  "/fixture-16team-rich.json": {
    file: path.join("fixtures", "fixture-16team-rich.json"),
    type: "application/json; charset=utf-8"
  }
};

export interface FixtureServer {
  url: string;
  richUrl: string;
  port: number;
  close: () => Promise<void>;
}

export function startFixtureServer(rootDir = process.cwd()): Promise<FixtureServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = ALLOWED[url.pathname];
    if (req.method !== "GET" || !route) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const filePath = path.join(rootDir, route.file);
    res.writeHead(200, {
      "content-type": route.type,
      "cache-control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Fixture server failed to bind 127.0.0.1"));
        return;
      }
      resolve({
        port: address.port,
        url: `http://127.0.0.1:${address.port}/fixture-draft-room`,
        richUrl: `http://127.0.0.1:${address.port}/fixture-draft-room-rich`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          })
      });
    });
  });
}
