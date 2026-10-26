/**
 * OpenAPI docs for the local Kady API: Swagger UI at /docs and the collected
 * spec at /docs/json. Routes are harvested from Fastify registrations; most
 * handlers have no JSON Schema, so parameter/body fields stay empty.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import { HOST, PORT } from "../config.ts";

function appVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version?.trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function registerOpenApiDocs(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Kady API",
        description:
          "Local K-Dense BYOK (Kady) backend. Paths and methods are collected " +
          "from registered Fastify routes; most handlers do not declare JSON " +
          "Schema, so request/response fields are usually empty. When the " +
          "server requires an access token, send it as `X-Kady-Token` (or " +
          "`Authorization: Bearer …`). Project-scoped routes also accept " +
          "`X-Project-Id`.",
        version: appVersion(),
      },
      servers: [
        {
          url: `http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`,
          description: "This Kady backend",
        },
      ],
      components: {
        securitySchemes: {
          kadyToken: {
            type: "apiKey",
            in: "header",
            name: "X-Kady-Token",
            description: "Access token when KADY_REQUIRE_AUTH or a non-loopback bind is enabled.",
          },
          projectId: {
            type: "apiKey",
            in: "header",
            name: "X-Project-Id",
            description: "Active project id (falls back to ?project, cookie, then default).",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    staticCSP: true,
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });
}
