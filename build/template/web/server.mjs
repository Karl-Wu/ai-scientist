#!/usr/bin/env node
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import process from "node:process";
import next from "next";
import { officeHttpsRedirect } from "./office-https.mjs";

const API_PREFIX = "/api/kady";
const frontendPort = Number(process.env.KADY_FRONTEND_PORT ?? 3000);
const frontendHost = process.env.KADY_FRONTEND_HOST ?? "0.0.0.0";
const backendHost = process.env.KADY_BACKEND_HOST ?? "127.0.0.1";
const backendPort = Number(process.env.KADY_PORT ?? 8000);
const httpsPort = process.env.KADY_HTTPS_PORT ? Number(process.env.KADY_HTTPS_PORT) : null;
const httpsHost = process.env.KADY_HTTPS_HOST ?? "0.0.0.0";
const tlsKey = process.env.KADY_TLS_KEY ?? "";
const tlsCert = process.env.KADY_TLS_CERT ?? "";

for (const [name, value] of [["frontend", frontendPort], ["backend", backendPort]]) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`[web] invalid ${name} port: ${value}`);
    process.exit(2);
  }
}
if (frontendPort === backendPort) {
  console.error("[web] frontend and backend ports must differ");
  process.exit(2);
}
if (httpsPort !== null && (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535)) {
  console.error(`[web] invalid https port: ${httpsPort}`);
  process.exit(2);
}
if ([frontendPort, backendPort].includes(httpsPort)) {
  console.error("[web] HTTPS port must differ from the frontend and backend ports");
  process.exit(2);
}
if (httpsPort !== null && (!tlsKey || !tlsCert || !fs.existsSync(tlsKey) || !fs.existsSync(tlsCert))) {
  console.error("[web] KADY_TLS_KEY and KADY_TLS_CERT are required when KADY_HTTPS_PORT is set");
  process.exit(2);
}

const app = next({ dev: false, dir: process.cwd(), hostname: frontendHost, port: frontendPort });
await app.prepare();
const handle = app.getRequestHandler();

function isApiPath(url) {
  return url === API_PREFIX || url.startsWith(`${API_PREFIX}/`) || url.startsWith(`${API_PREFIX}?`);
}

function proxy(req, res, url) {
  const targetPath = url.slice(API_PREFIX.length) || "/";
  const headers = { ...req.headers, host: `${backendHost}:${backendPort}` };
  const upstream = http.request(
    { host: backendHost, port: backendPort, method: req.method, path: targetPath, headers },
    (upstreamRes) => {
      const responseHeaders = { ...upstreamRes.headers };
      if (String(responseHeaders["content-type"] ?? "").includes("text/event-stream")) {
        responseHeaders["x-accel-buffering"] = "no";
        responseHeaders["cache-control"] = "no-cache";
      }
      res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", (error) => {
    console.error(`[proxy] ${req.method} ${targetPath}: ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
    }
    res.end(JSON.stringify({ error: "backend_unreachable", message: error.message }));
  });
  req.on("error", () => upstream.destroy());
  req.pipe(upstream);
}

function requestHandler(req, res) {
  const url = req.url ?? "/";
  if (isApiPath(url)) {
    proxy(req, res, url);
    return;
  }
  handle(req, res).catch((error) => {
    console.error("[web] request failed:", error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal Server Error");
  });
}

function httpRequestHandler(req, res) {
  const redirect = officeHttpsRedirect(req, httpsPort);
  if (redirect) {
    res.writeHead(308, { Location: String(redirect), "Cache-Control": "public, max-age=31536000" });
    res.end();
    return;
  }
  requestHandler(req, res);
}

const server = http.createServer(httpRequestHandler);
const httpsServer = httpsPort === null ? null : https.createServer({
  key: fs.readFileSync(tlsKey),
  cert: fs.readFileSync(tlsCert),
}, requestHandler);

server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 65_000;
server.listen(frontendPort, frontendHost, () => {
  const shown = frontendHost === "0.0.0.0" || frontendHost === "::" ? "127.0.0.1" : frontendHost;
  console.log(`[web] http://${shown}:${frontendPort}`);
  console.log(`[web] ${API_PREFIX}/* -> http://${backendHost}:${backendPort}/*`);
});

if (httpsServer) {
  httpsServer.requestTimeout = 0;
  httpsServer.headersTimeout = 65_000;
  httpsServer.keepAliveTimeout = 65_000;
  httpsServer.listen(httpsPort, httpsHost, () => {
    const shown = httpsHost === "0.0.0.0" || httpsHost === "::" ? "127.0.0.1" : httpsHost;
    console.log(`[web] https://${shown}:${httpsPort} (self-signed certificate accepted by browser configuration)`);
  });
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    let pending = 1 + (httpsServer ? 1 : 0);
    const closed = () => {
      if (--pending === 0) process.exit(0);
    };
    server.close(closed);
    httpsServer?.close(closed);
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
