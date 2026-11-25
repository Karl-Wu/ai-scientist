import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { coughDuration } from "./entry.mjs";
import { vocabularyCsv } from "./omop.mjs";
import { createHttpServer } from "./server.mjs";
import { openStore } from "./store.mjs";

const writeToken = "test-write-token-for-knowledge-service";
const readToken = "test-read-token-for-knowledge-service";

async function connect(endpoint, token) {
  const client = new Client({ name: "kady-kb-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}

const sampleEntry = {
  conceptCode: "synthetic_field",
  label: "模拟字段",
  englishName: "Synthetic field",
  definition: "用于集成测试的虚构条目。",
  valueType: "text",
  unit: null,
  ruleText: "仅提取作为测试输入给出的文本。",
  source: { document: "Synthetic test fixture", locator: "item 1" },
};

test("MCP validates access and arguments and publishes new entries across sessions", async () => {
  const store = openStore(":memory:");
  const server = createHttpServer({ store, writeToken, readToken });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal((await fetch(endpoint, { headers: { Origin: "https://example.test" } })).status, 403);

    const writer = await connect(endpoint, writeToken);
    const reader = await connect(endpoint, readToken);
    try {
      assert.equal(writer.getServerVersion()?.title, "专病知识库");
      assert.deepEqual((await reader.listTools()).tools.map(({ name }) => name), ["kb_search"]);
      assert.deepEqual((await writer.listTools()).tools.map(({ name }) => name), ["kb_search", "kb_create"]);
      const search = async (query, crfTable) => (await reader.callTool({ name: "kb_search", arguments: { query, crfTable } })).structuredContent;
      const submit = (input) => writer.callTool({ name: "kb_create", arguments: input });

      const known = await search("咳嗽_时长有什么表现？");
      assert.equal(known.status, "found");
      assert.equal(known.entry.conceptCode, "sym_cough_duration");
      assert.equal(known.entry.conceptId, 2097222564);
      assert.equal(known.entry.crfTable, "症状表");
      assert.equal(known.entry.unit, "月");
      assert.equal(known.entry.source.locator, "慢阻肺CRF量表!B57:H57");
      assert.equal(known.entry.sourceVerification, "verified_against_workbook");
      assert.match(known.entry.ruleText, /咳嗽\/咳喘/);
      assert.match(known.entry.gaps[0], /换算/);
      assert.equal((await search("咳嗽_加重时长")).status, "not_found");
      assert.equal((await search("时长")).status, "not_found");
      assert.equal((await search("cough duration")).entry.conceptCode, known.entry.conceptCode);
      assert.equal((await search("咳嗽时长", "症状表")).entry.conceptId, known.entry.conceptId);
      for (const question of ["咳嗽持续多久？", "咳嗽持续了多长时间？", "如何记录咳嗽的持续时间？"]) {
        assert.equal((await search(question, "症状表")).entry.conceptId, known.entry.conceptId);
      }
      assert.equal((await search("咳嗽加重持续多久？")).status, "not_found");
      assert.equal((await search("为什么会咳嗽？")).status, "not_found");
      assert.equal((await search("sym_cough_duration", "其他表")).status, "not_found");
      assert.equal((await search("咳嗽_时长", "其他表")).status, "not_found");

      assert.equal((await search("模拟字段")).status, "not_found");
      assert.ok((await reader.callTool({ name: "kb_create", arguments: sampleEntry })).isError);
      const { source: _source, ...noSource } = sampleEntry;
      assert.ok((await submit(noSource)).isError);
      assert.ok((await submit({ ...sampleEntry, standard_concept: "S" })).isError);
      assert.equal((await search("模拟字段")).status, "not_found");

      const responses = await Promise.all([submit(sampleEntry), submit(sampleEntry)]);
      assert.deepEqual(responses.map((response) => response.structuredContent.status).sort(), ["already_exists", "created"]);
      const published = await search("模拟字段");
      assert.equal(published.status, "found");
      assert.equal(published.entry.sourceVerification, "submitted_by_agent");
      assert.equal(published.entry.revision, 1);
      const conflict = await submit({ ...sampleEntry, ruleText: "另一条测试规则。" });
      assert.ok(conflict.isError);
      assert.equal(conflict.structuredContent.status, "conflict");
      assert.equal((await search("模拟字段")).entry.ruleText, sampleEntry.ruleText);

      await submit({ ...sampleEntry, conceptCode: "synthetic_alias_collision", crfTable: "用药表" });
      assert.equal((await search("模拟字段")).status, "ambiguous");
      assert.equal((await search("synthetic_field")).entry.conceptCode, "synthetic_field");
      assert.equal((await search("模拟字段", "用药表")).entry.conceptCode, "synthetic_alias_collision");
      assert.ok((await submit({ ...coughDuration, unit: "天" })).isError);
      assert.equal((await search("sym_cough_duration")).entry.unit, "月");
    } finally {
      await Promise.all([writer.close(), reader.close()]);
    }
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});

test("SQLite preserves published data and exports the OMOP CDM 5.5 vocabulary subset", () => {
  const directory = mkdtempSync(join(tmpdir(), "kady-kb-test-"));
  const path = join(directory, "test.sqlite");
  let store = openStore(path);
  try {
    const before = store.exportVocabulary();
    const created = store.create({ ...sampleEntry, aliases: [], gaps: [] });
    assert.equal(created.status, "created");
    store.close();
    store = openStore(path);

    assert.equal(store.search("模拟字段").entry.conceptId, created.entry.conceptId);
    const vocabulary = store.exportVocabulary();
    assert.equal(vocabulary.VOCABULARY[0].vocabulary_id, "KADY_CRF");
    assert.notEqual(vocabulary.VOCABULARY[0].vocabulary_version, before.VOCABULARY[0].vocabulary_version);
    assert.deepEqual(vocabulary.CONCEPT.map(Object.keys), [
      ["concept_id", "concept_name", "domain_id", "vocabulary_id", "concept_class_id", "standard_concept", "concept_code", "valid_start_date", "valid_end_date", "invalid_reason"],
      ["concept_id", "concept_name", "domain_id", "vocabulary_id", "concept_class_id", "standard_concept", "concept_code", "valid_start_date", "valid_end_date", "invalid_reason"],
    ]);
    assert.ok(vocabulary.CONCEPT.every((concept) => concept.concept_id > 2_000_000_000 && concept.standard_concept === null));
    assert.ok(vocabulary.CONCEPT_SYNONYM.some((item) => item.concept_synonym_name === "咳嗽_时长"));
    assert.ok(vocabulary.CONCEPT_SYNONYM.every((item) => vocabulary.CONCEPT.some(({ concept_id }) => item.concept_id === concept_id)));
    assert.deepEqual(vocabulary.CONCEPT_RELATIONSHIP, []);
    assert.equal(JSON.stringify(vocabulary).includes(coughDuration.ruleText), false);
    const csv = vocabularyCsv(vocabulary);
    assert.equal(csv["CONCEPT_RELATIONSHIP.csv"], "concept_id_1,concept_id_2,relationship_id,valid_start_date,valid_end_date,invalid_reason\r\n");
    assert.match(csv["CONCEPT.csv"], /^2097222564,"Cough duration","Observation","KADY_CRF","Undefined",,"sym_cough_duration",/m);
    assert.match(csv["CONCEPT_SYNONYM.csv"], /2097222564,"咳嗽_时长",0/);
    assert.ok(store.exportVocabulary(123).CONCEPT_SYNONYM.some((item) =>
      item.concept_synonym_name === "咳嗽_时长" && item.language_concept_id === 123));
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a cleared database stays empty when opened and supports new entries and exports", () => {
  const directory = mkdtempSync(join(tmpdir(), "kady-kb-cleared-"));
  const path = join(directory, "cleared.sqlite");
  let store = openStore(path);
  try {
    assert.equal(store.search("咳嗽_时长").status, "found");
    store.close();
    store = undefined;

    const writer = new DatabaseSync(path);
    try {
      writer.exec(`
        DELETE FROM CONCEPT_RELATIONSHIP;
        DELETE FROM CONCEPT_SYNONYM;
        DELETE FROM CRF_FIELD_RULE;
        DELETE FROM CONCEPT;
        DELETE FROM VOCABULARY;
      `);
    } finally {
      writer.close();
    }

    store = openStore(path);
    assert.equal(store.search("咳嗽持续多久？").status, "not_found");
    assert.deepEqual(store.entries(), []);
    const vocabulary = store.exportVocabulary();
    assert.ok(Object.values(vocabulary).every((rows) => rows.length === 0));
    assert.ok(Object.values(vocabularyCsv(vocabulary)).every((csv) => csv.trimEnd().split("\r\n").length === 1));

    assert.equal(store.create({ ...sampleEntry, aliases: [], gaps: [] }).status, "created");
    assert.equal(store.search(sampleEntry.label).status, "found");
    assert.equal(store.exportVocabulary().VOCABULARY[0].vocabulary_id, "KADY_CRF");
    assert.equal(store.search("咳嗽_时长").status, "not_found");
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy entries move to OMOP tables and remain recoverable from the backup", () => {
  const directory = mkdtempSync(join(tmpdir(), "kady-kb-legacy-"));
  const path = join(directory, "legacy.sqlite");
  const { crfTable, ...legacySeed } = coughDuration;
  const serialized = JSON.stringify(legacySeed);
  let store;
  try {
    const legacy = new DatabaseSync(path);
    try {
      legacy.exec(`
        CREATE TABLE entries (
          concept_id INTEGER PRIMARY KEY, code TEXT UNIQUE, payload TEXT, published_at TEXT, origin TEXT
        );
        CREATE TABLE entry_terms (term TEXT, concept_id INTEGER REFERENCES entries(concept_id), PRIMARY KEY (term, concept_id));
        CREATE VIEW CONCEPT AS SELECT concept_id FROM entries;
        CREATE VIEW CRF_FIELD_RULE AS SELECT payload FROM entries;
      `);
      legacy.prepare("INSERT INTO entries VALUES (?, ?, ?, ?, ?)")
        .run(2097222564, legacySeed.conceptCode, serialized, "2026-11-24T00:00:00.000Z", "seed");
    } finally {
      legacy.close();
    }
    assert.throws(() => openStore(path), /Start the upgraded knowledge service/);
    store = openStore(path, { migrateLegacy: true });
    assert.equal(store.search("咳嗽时长", crfTable).entry.ruleText, legacySeed.ruleText);
    assert.equal(store.create(coughDuration).status, "already_exists");

    const browser = new DatabaseSync(path, { readOnly: true });
    try {
      assert.deepEqual(browser.prepare(`
        SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name
      `).all().map(({ name }) => name), [
        "COHORT", "COHORT_DEFINITION", "CONCEPT", "CONCEPT_ANCESTOR", "CONCEPT_CLASS",
        "CONCEPT_METADATA", "CONCEPT_RELATIONSHIP", "CONCEPT_RELATIONSHIP_METADATA", "CONCEPT_SYNONYM",
        "CRF_FIELD_RULE", "DOMAIN", "DRUG_STRENGTH", "PACK_CONTENT", "RELATIONSHIP", "SOURCE_TO_CONCEPT_MAP", "VOCABULARY",
      ]);
      const rule = browser.prepare(`
        SELECT c.standard_concept, r.crf_table, r.unit, r.source_locator
        FROM CONCEPT c JOIN CRF_FIELD_RULE r USING (concept_id)
        WHERE c.concept_code = 'sym_cough_duration'
      `).get();
      assert.deepEqual({ ...rule }, {
        standard_concept: null, crf_table: "症状表", unit: "月", source_locator: "慢阻肺CRF量表!B57:H57",
      });
    } finally {
      browser.close();
    }
    const [backupName] = readdirSync(join(directory, "backups"));
    const backup = new DatabaseSync(join(directory, "backups", backupName), { readOnly: true });
    try {
      assert.equal(backup.prepare("SELECT payload FROM entries").get().payload, serialized);
    } finally {
      backup.close();
    }
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a legacy record that cannot be migrated rolls back the old schema and data", () => {
  const directory = mkdtempSync(join(tmpdir(), "kady-kb-invalid-legacy-"));
  const path = join(directory, "legacy.sqlite");
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec(`
      CREATE TABLE entries (concept_id INTEGER PRIMARY KEY, code TEXT, payload TEXT, published_at TEXT, origin TEXT);
      CREATE VIEW CONCEPT AS SELECT concept_id FROM entries;
    `);
    const insert = legacy.prepare("INSERT INTO entries VALUES (?, ?, ?, ?, 'seed')");
    insert.run(2097222564, coughDuration.conceptCode, JSON.stringify(coughDuration), "2026-11-24T00:00:00.000Z");
    insert.run(2097222565, "invalid_field", "{}", "2026-11-24T00:00:00.000Z");

    assert.throws(() => openStore(path, { migrateLegacy: true }), /Cannot migrate invalid legacy field invalid_field/);
    assert.equal(legacy.prepare("SELECT count(*) AS count FROM entries").get().count, 2);
    assert.equal(legacy.prepare("SELECT type FROM sqlite_schema WHERE name = 'CONCEPT'").get().type, "view");
    assert.equal(legacy.prepare("SELECT name FROM sqlite_schema WHERE name = 'CRF_FIELD_RULE'").get(), undefined);
  } finally {
    legacy.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
