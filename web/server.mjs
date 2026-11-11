#!/usr/bin/env node
/**
 * Production server for the packaged platform.
 *
 * Why not `next start`: the browser must reach the backend on the same origin
 * (the API can run shell commands, so it stays bound to 127.0.0.1), while the
 * backend port is operator-configurable through platform.env. A Next rewrite
 * is evaluated at build time and would freeze that port into the manifest, so
 * the proxy lives here and reads KADY_PORT on every start instead.
 *
 * Everything except /api/kady/* is handed to Next unchanged; streaming (SSE)
 * responses are piped straight through without buffering.
 */
import http from "node:http";
import process from "node:process";
import next from "next";

/** Must match NEXT_PUBLIC_ADK_API_URL baked into the frontend build. */
const API_PREFIX = "/api/kady";

const port = Number(process.env.KADY_FRONTEND_PORT ?? 3000);
const hostname = process.env.KADY_FRONTEND_HOST ?? "0.0.0.0";
const backendHost = process.env.KADY_BACKEND_HOST ?? "127.0.0.1";
const backendPort = Number(process.env.KADY_PORT ?? 8000);
const dev = process.env.NODE_ENV === "development";

function assertPort(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`[web] invalid ${name}=${value}; expected 1-65535`);
    process.exit(2);
  }
}

assertPort("KADY_FRONTEND_PORT", port);
assertPort("KADY_PORT", backendPort);

const app = next({ dev, dir: process.cwd(), hostname, port });
await app.prepare();
const handle = app.getRequestHandler();

function isApiPath(url) {
  return url === API_PREFIX || url.startsWith(`${API_PREFIX}/`) || url.startsWith(`${API_PREFIX}?`);
}

function proxyToBackend(req, res, url) {
  const targetPath = url.slice(API_PREFIX.length) || "/";
  const headers = { ...req.headers, host: `${backendHost}:${backendPort}` };

  const upstream = http.request(
    { host: backendHost, port: backendPort, method: req.method, path: targetPath, headers },
    (upstreamRes) => {
      const responseHeaders = { ...upstreamRes.headers };
      if ((responseHeaders["content-type"] ?? "").includes("text/event-stream")) {
        // Caddy/nginx style reverse proxies buffer by default and would stall SSE.
        responseHeaders["x-accel-buffering"] = "no";
      }
      // writeHead + pipe keeps SSE chunks flowing: no content-length buffering.
      res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    console.error(`[proxy] ${req.method} ${url} -> ${backendHost}:${backendPort} failed: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
    }
    res.end(JSON.stringify({ error: "backend_unreachable", message: err.message }));
  });

  req.on("error", () => upstream.destroy());
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (isApiPath(url)) {
    proxyToBackend(req, res, url);
    return;
  }
  handle(req, res).catch((err) => {
    console.error("[web] request failed:", err);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  });
});

// Agent runs and chat streams are long-lived; Node's 300s default would cut them.
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 65_000;
server.on("clientError", (_err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(port, hostname, () => {
  const shown = hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname;
  console.log(`[web] listening on http://${shown}:${port}`);
  console.log(`[web] ${API_PREFIX}/* -> http://${backendHost}:${backendPort}/*`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
