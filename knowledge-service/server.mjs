import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { entrySchema, querySchema } from "./entry.mjs";

export const KNOWLEDGE_SERVICE_TITLE = "专病知识库";

function result(value, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError };
}

function createMcpServer(store, canWrite) {
  const server = new McpServer({ name: "kady-crf-kb", title: KNOWLEDGE_SERVICE_TITLE, version: "0.1.0" });
  server.registerTool("kb_search", {
    description: "从专病知识库查询慢阻肺 CRF 字段定义、原始提取规则、单位、缺口和出处。返回 ambiguous 时请用户选择字段，返回 not_found 时说明未收录。引用来源，并区分已核验来源与 Agent 提交来源。",
    inputSchema: querySchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ query, crfTable }) => result(store.search(query, crfTable)));

  if (canWrite) {
    server.registerTool("kb_create", {
      description: "新增一条独立的 CRF 字段知识，提交后立即可检索。仅在用户要求写入时调用。须提供可追溯的规则来源，不提交病历和个人信息。字段或来源缺失时先向用户确认。相同编码的已有词条不会被覆盖。",
      inputSchema: entrySchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, (entry) => {
      const created = store.create(entry);
      return result(created, created.status === "conflict");
    });
  }
  return server;
}

const tokenDigest = (token) => createHash("sha256").update(token).digest();
const validToken = (token) => /^[\x21-\x7e]{24,256}$/u.test(token ?? "");

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

export function createHttpServer({ store, writeToken, readToken }) {
  if (!validToken(writeToken) || (readToken && !validToken(readToken))) {
    throw new Error("Configure KADY_KB_TOKEN (and optional KADY_KB_READ_TOKEN) with 24–256 printable ASCII characters and no spaces.");
  }
  if (writeToken === readToken) throw new Error("Read and write tokens must be different.");
  const writeDigest = tokenDigest(writeToken);
  const readDigest = readToken ? tokenDigest(readToken) : null;

  return createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (request, response) => {
    if (request.headers.origin) return json(response, 403, { error: "Browser origins are not accepted." });
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { status: "ok" });
    if (request.url !== "/mcp") return json(response, 404, { error: "Not found." });

    const bearer = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? "")?.[1];
    const supplied = bearer && tokenDigest(bearer);
    const canWrite = Boolean(supplied && timingSafeEqual(supplied, writeDigest));
    if (!canWrite && !(supplied && readDigest && timingSafeEqual(supplied, readDigest))) {
      response.setHeader("WWW-Authenticate", "Bearer");
      return json(response, 401, { error: "Bearer authentication required." });
    }

    const mcp = createMcpServer(store, canWrite);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.setHeader("Cache-Control", "no-store");
    response.once("close", () => { void mcp.close(); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      console.error("Failed to handle a knowledge MCP request", error.name);
      if (!response.headersSent) json(response, 500, { error: "Internal service error." });
      else response.end();
    }
  });
}
