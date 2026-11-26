import test from "node:test";
import assert from "node:assert/strict";
import { buildGateway } from "../src/app.ts";
import { readConfig } from "../src/config.ts";

test("configuration errors identify the key without printing credentials", () => {
  for (const url of ["", "secret", "http://user:secret@host"]) {
    assert.throws(() => readConfig({ GATEWAY_DATABASE_URL: url }), {
      message: /^GATEWAY_DATABASE_URL (?!.*secret)/,
    });
  }
  assert.throws(() => readConfig({ GATEWAY_DATABASE_URL: "postgres://db/kady", GATEWAY_PORT: "0" }), /GATEWAY_PORT/);
});

test("loss and recovery of database connectivity changes readiness only", async (t) => {
  let online = false;
  const app = buildGateway(async () => { if (!online) throw new Error("sensitive detail"); });
  t.after(() => app.close());
  const unavailable = await app.inject("/readyz");
  assert.equal(unavailable.statusCode, 503);
  assert.deepEqual(unavailable.json(), { status: "unavailable" });
  assert.equal((await app.inject("/livez")).statusCode, 200);
  online = true;
  assert.equal((await app.inject("/readyz")).statusCode, 200);
  assert.equal((await app.inject("/api/kady/projects")).statusCode, 404);
});
