/**
 * /docs Swagger UI + OpenAPI JSON collected from registered Fastify routes.
 */
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

import { PROJECTS_ROOT } from "../src/config.ts";
import { buildApp } from "../src/index.ts";

const app = await buildApp();

afterAll(async () => {
  await app.close();
  fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true });
});

describe("OpenAPI docs", () => {
  it("serves Swagger UI at /docs without the sandbox CSP", async () => {
    const res = await app.inject({ method: "GET", url: "/docs" });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"] ?? "")).toMatch(/text\/html/);
    // Sandbox CSP disables scripts; Swagger UI cannot run under it.
    expect(String(res.headers["content-security-policy"] ?? "")).not.toMatch(/^sandbox/);
  });

  it("exposes OpenAPI JSON that lists registered routes", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      openapi?: string;
      info?: { title?: string; version?: string };
      paths?: Record<string, unknown>;
    };
    expect(body.openapi).toMatch(/^3\./);
    expect(body.info?.title).toBeTruthy();
    expect(body.info?.version).toBeTruthy();
    expect(body.paths?.["/health"]).toBeTruthy();
    expect(body.paths?.["/projects"]).toBeTruthy();
  });
});
