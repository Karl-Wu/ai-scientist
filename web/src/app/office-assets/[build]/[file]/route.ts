import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { OFFICE_ASSETS, OFFICE_BUILD } from "@/lib/office-assets";
export const runtime = "nodejs";
const pending = new Map<string, Promise<string>>();
const gzipPending = new Map<string, Promise<string>>();
const verified = new Map<string, string>();
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function asset(name: string): Promise<string> {
  const root = process.env.KADY_OFFICE_ASSETS_DIR || path.join(os.homedir(), ".kady", "office-assets", OFFICE_BUILD);
  const file = path.join(root, name), spec = OFFICE_ASSETS[name];
  await fs.promises.mkdir(root, { recursive: true });
  const verifyCached = async () => {
    const stat = await fs.promises.stat(file);
    const version = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (verified.get(file) === version) return true;
    const bytes = await fs.promises.readFile(file);
    if (hash(bytes) !== spec.sha256) return false;
    verified.set(file, version);
    return true;
  };
  try { if (await verifyCached()) return file; } catch { /* Populate from a bundled compressed asset or upstream. */ }
  try {
    await fs.promises.access(`${file}.gz`);
    const staging = `${file}.${randomUUID()}.tmp`;
    try {
      await pipeline(fs.createReadStream(`${file}.gz`), createGunzip(), fs.createWriteStream(staging));
      await fs.promises.rename(staging, file);
    } finally {
      await fs.promises.rm(staging, { force: true });
    }
    if (await verifyCached()) return file;
  } catch { /* Fall through to the pinned upstream download. */ }
  const response = await fetch(spec.source ?? `https://cdn.zetaoffice.net/zetaoffice_latest/${name}`, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error("Could not download the Office editor. Check your connection and retry.");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > (spec.size || 1_000_000) + 1024) throw new Error("Unexpected Office runtime size");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (hash(bytes) !== spec.sha256) throw new Error("The Office runtime download differs from the tested version. Update AI Scientist or retry later.");
  const staging = `${file}.${randomUUID()}.tmp`;
  try { await fs.promises.writeFile(staging, bytes); await fs.promises.rename(staging, file); }
  finally { await fs.promises.rm(staging, { force: true }); }
  return file;
}

async function gzipAsset(file: string): Promise<string> {
  const compressed = `${file}.gz`;
  let job = gzipPending.get(file);
  if (!job) {
    job = (async () => {
      const stat = await fs.promises.stat(compressed);
      if (stat.isFile() && stat.size > 0) return compressed;
      throw new Error("compressed asset is missing");
    })().catch(async () => {
      const staging = `${compressed}.${randomUUID()}.tmp`;
      try {
        await pipeline(fs.createReadStream(file), createGzip({ level: 9 }), fs.createWriteStream(staging));
        await fs.promises.rename(staging, compressed);
        return compressed;
      } finally {
        await fs.promises.rm(staging, { force: true });
      }
    }).finally(() => gzipPending.delete(file));
    gzipPending.set(file, job);
  }
  return job;
}

export async function GET(_request: Request, context: { params: Promise<{ build: string; file: string }> }) {
  const params = await context.params;
  if (params.build !== OFFICE_BUILD || !Object.hasOwn(OFFICE_ASSETS, params.file)) return new Response("Not found", { status: 404 });
  let job = pending.get(params.file);
  if (!job) { job = asset(params.file); pending.set(params.file, job); void job.finally(() => pending.delete(params.file)).catch(() => {}); }
  try {
    const file = await job;
    const spec = OFFICE_ASSETS[params.file];
    if (/\bgzip\b/i.test(_request.headers.get("accept-encoding") ?? "") && spec.size > 1024) {
      const compressed = await gzipAsset(file);
      const stat = fs.statSync(compressed);
      return new Response(Readable.toWeb(fs.createReadStream(compressed)) as ReadableStream, { headers: {
        "Content-Type": spec.type,
        "Content-Encoding": "gzip",
        "Content-Length": String(stat.size),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        Vary: "Accept-Encoding",
        ETag: `"${spec.sha256}-gzip"`,
      } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: {
      "Content-Type": spec.type, "Content-Length": String(fs.statSync(file).size),
      "Cache-Control": "public, max-age=31536000, immutable", "Cross-Origin-Resource-Policy": "same-origin", "X-Content-Type-Options": "nosniff",
      Vary: "Accept-Encoding", ETag: `"${spec.sha256}"`,
    } });
  } catch (e) { return new Response(e instanceof Error ? e.message : "Office runtime unavailable", { status: 503 }); }
}
