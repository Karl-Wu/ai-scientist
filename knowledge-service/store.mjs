import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { coughDuration, entrySchema, normalizeTerm, questionTerm } from "./entry.mjs";
import { englishLanguageId, omopTables, omopVocabulary, vocabularyId } from "./omop.mjs";

const CUSTOM_ID_BASE = 2_000_000_000;
const CUSTOM_ID_SPAN = 100_000_000;
const LEGACY_VIEWS = ["CONCEPT_SYNONYM", "CRF_FIELD_RULE", "CONCEPT", "CONCEPT_RELATIONSHIP", "VOCABULARY"];

const ruleTable = `
  CREATE TABLE IF NOT EXISTS CRF_FIELD_RULE (
    concept_id INTEGER PRIMARY KEY REFERENCES CONCEPT(concept_id),
    crf_table TEXT,
    label TEXT NOT NULL,
    definition TEXT NOT NULL,
    value_type TEXT NOT NULL CHECK (value_type IN ('number', 'integer', 'text', 'boolean', 'date', 'coded')),
    unit TEXT,
    rule_text TEXT NOT NULL,
    gaps_json TEXT NOT NULL CHECK (json_valid(gaps_json) AND json_type(gaps_json) = 'array'),
    source_document TEXT NOT NULL,
    source_locator TEXT NOT NULL,
    source_sha256 TEXT,
    published_at TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('seed', 'agent'))
  ) STRICT;
`;

function canonicalEntry(entry) {
  const names = new Set([entry.label, entry.englishName]);
  return {
    ...entry,
    aliases: [...new Set(entry.aliases)].filter((alias) => !names.has(alias)),
  };
}

function readField(row) {
  return {
    conceptCode: row.concept_code,
    label: row.label,
    englishName: row.concept_name,
    ...(row.crf_table === null ? {} : { crfTable: row.crf_table }),
    aliases: JSON.parse(row.aliases_json),
    definition: row.definition,
    valueType: row.value_type,
    unit: row.unit,
    ruleText: row.rule_text,
    gaps: JSON.parse(row.gaps_json),
    source: {
      document: row.source_document,
      locator: row.source_locator,
      ...(row.source_sha256 === null ? {} : { sha256: row.source_sha256 }),
    },
  };
}

function readEntry(row) {
  return {
    ...readField(row),
    conceptId: row.concept_id,
    revision: 1,
    publishedAt: row.published_at,
    origin: row.origin,
    sourceVerification: row.origin === "seed" ? "verified_against_workbook" : "submitted_by_agent",
  };
}

const fieldSelection = `
  SELECT c.concept_code, c.concept_name, r.*,
    (SELECT json_group_array(term.concept_synonym_name) FROM (
      SELECT s.concept_synonym_name FROM CONCEPT_SYNONYM AS s
      WHERE s.concept_id = c.concept_id AND s.concept_synonym_name NOT IN (c.concept_name, r.label)
      GROUP BY s.concept_synonym_name ORDER BY min(s.rowid)
    ) AS term) AS aliases_json
  FROM CONCEPT AS c JOIN CRF_FIELD_RULE AS r USING (concept_id)
`;

function fieldStatements(db) {
  const ensureVocabulary = db.prepare(`
    INSERT INTO VOCABULARY (vocabulary_id, vocabulary_name, vocabulary_concept_id)
    VALUES (?, 'Kady local CRF field vocabulary', 0)
    ON CONFLICT (vocabulary_id) DO NOTHING
  `);
  const insertConcept = db.prepare(`
    INSERT INTO CONCEPT (concept_id, concept_name, domain_id, vocabulary_id, concept_class_id,
      concept_code, valid_start_date, valid_end_date)
    VALUES (?, ?, 'Observation', ?, 'Undefined', ?, ?, '2099-12-31')
  `);
  const insertSynonym = db.prepare("INSERT INTO CONCEPT_SYNONYM VALUES (?, ?, ?)");
  const insertRule = db.prepare(`
    INSERT INTO CRF_FIELD_RULE (concept_id, crf_table, label, definition, value_type, unit,
      rule_text, gaps_json, source_document, source_locator, source_sha256, published_at, origin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const byCode = db.prepare(`${fieldSelection} WHERE c.vocabulary_id = ? AND c.concept_code = ?`);
  const idExists = db.prepare("SELECT 1 FROM CONCEPT WHERE concept_id = ?");
  return {
    byCode: (code) => byCode.get(vocabularyId, code),
    allocateId(code) {
      const hash = createHash("sha256").update(code).digest().readUInt32BE(0);
      let offset = hash % CUSTOM_ID_SPAN || 1;
      while (idExists.get(CUSTOM_ID_BASE + offset)) offset = offset % CUSTOM_ID_SPAN + 1;
      return CUSTOM_ID_BASE + offset;
    },
    insert(entry, conceptId, publishedAt, origin) {
      ensureVocabulary.run(vocabularyId);
      insertConcept.run(conceptId, entry.englishName, vocabularyId, entry.conceptCode, publishedAt.slice(0, 10));
      insertRule.run(conceptId, entry.crfTable ?? null, entry.label, entry.definition, entry.valueType, entry.unit,
        entry.ruleText, JSON.stringify(entry.gaps), entry.source.document, entry.source.locator,
        entry.source.sha256 ?? null, publishedAt, origin);
      const terms = new Map([[entry.englishName, englishLanguageId]]);
      for (const term of [entry.label, ...entry.aliases]) {
        if (!terms.has(term)) terms.set(term, 0);
      }
      for (const [term, languageId] of terms) insertSynonym.run(conceptId, term, languageId);
    },
  };
}

function backupLegacy(db, path) {
  if (path === ":memory:") return;
  const directory = join(dirname(path), "backups");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, `pre-omop-${randomUUID()}.sqlite`);
  closeSync(openSync(target, "wx", 0o600));
  try {
    db.prepare("VACUUM INTO ?").run(target);
    const backup = new DatabaseSync(target, { readOnly: true });
    try {
      if (backup.prepare("PRAGMA quick_check").get().quick_check !== "ok") {
        throw new Error("Legacy database backup failed integrity check.");
      }
    } finally {
      backup.close();
    }
  } catch (error) {
    unlinkSync(target);
    throw error;
  }
}

function initialize(db, path, migrateLegacy) {
  const objectType = db.prepare("SELECT type FROM sqlite_schema WHERE name = ? COLLATE NOCASE");
  const legacy = objectType.get("entries")?.type === "table";
  const dataVersion = db.prepare("PRAGMA data_version");
  const beforeBackup = dataVersion.get().data_version;
  if (legacy) {
    if (!migrateLegacy) throw new Error("Start the upgraded knowledge service to migrate the legacy entries table.");
    backupLegacy(db, path);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const fresh = !legacy && !objectType.get("CONCEPT");
    if (legacy && dataVersion.get().data_version !== beforeBackup) {
      throw new Error("The legacy database changed during backup. Stop the old writer and start the service again.");
    }
    if (legacy) {
      for (const name of LEGACY_VIEWS) {
        if (objectType.get(name)?.type === "view") db.exec(`DROP VIEW ${name}`);
      }
    }
    db.exec(omopTables + ruleTable);
    const fields = fieldStatements(db);
    if (legacy) {
      const rows = db.prepare("SELECT concept_id, code, payload, published_at, origin FROM entries ORDER BY concept_id").all();
      for (const row of rows) {
        const parsed = entrySchema.safeParse(JSON.parse(row.payload));
        if (!parsed.success || parsed.data.conceptCode !== row.code) {
          throw new Error(`Cannot migrate invalid legacy field ${row.code}.`);
        }
        const entry = canonicalEntry(parsed.data);
        if (row.origin === "seed" && row.code === coughDuration.conceptCode) entry.crfTable ??= coughDuration.crfTable;
        fields.insert(entry, row.concept_id, row.published_at, row.origin);
        const saved = fields.byCode(row.code);
        if (saved.concept_id !== row.concept_id || !isDeepStrictEqual(readField(saved), entry)) {
          throw new Error(`Legacy field ${row.code} did not round-trip into the OMOP tables.`);
        }
      }
      db.exec("DROP TABLE IF EXISTS entry_terms; DROP TABLE entries");
      if (db.prepare("PRAGMA foreign_key_check").get()) throw new Error("OMOP migration failed foreign key validation.");
    } else if (fresh) {
      fields.insert(coughDuration, fields.allocateId(coughDuration.conceptCode), new Date().toISOString(), "seed");
    }
    db.exec("COMMIT");
    return fields;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openStore(path, { migrateLegacy = false } = {}) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { timeout: 5000 });
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    const fields = initialize(db, path, migrateLegacy);
    db.function("normalize_kb_term", { deterministic: true }, normalizeTerm);
    const byTerm = db.prepare(`
      WITH matched AS (
        SELECT concept_id FROM CONCEPT_SYNONYM WHERE normalize_kb_term(concept_synonym_name) = :term
        UNION
        SELECT concept_id FROM CONCEPT WHERE normalize_kb_term(concept_code) = :term
        UNION
        SELECT concept_id FROM CRF_FIELD_RULE WHERE normalize_kb_term(label) = :term
      )
      ${fieldSelection} JOIN matched ON matched.concept_id = c.concept_id
      WHERE c.vocabulary_id = :vocabulary AND (:crfTable IS NULL OR r.crf_table = :crfTable)
      ORDER BY c.concept_code LIMIT 21
    `);
    function create(input) {
      const entry = canonicalEntry(input);
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = fields.byCode(entry.conceptCode);
        let result;
        if (existing) {
          const saved = readField(existing);
          if (saved.crfTable !== undefined) entry.crfTable ??= saved.crfTable;
          result = isDeepStrictEqual(saved, entry)
            ? { status: "already_exists", entry: readEntry(existing) }
            : { status: "conflict", conceptCode: entry.conceptCode, message: "该编码已有不同内容。请先查询已有词条。" };
        } else {
          fields.insert(entry, fields.allocateId(entry.conceptCode), new Date().toISOString(), "agent");
          result = { status: "created", entry: readEntry(fields.byCode(entry.conceptCode)) };
        }
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }

    return {
      create,
      search(query, crfTable = null) {
        const exactCode = fields.byCode(query.normalize("NFKC").trim().toLowerCase());
        if (exactCode) {
          return crfTable === null || crfTable === exactCode.crf_table
            ? { status: "found", entry: readEntry(exactCode) }
            : { status: "not_found" };
        }
        const exact = byTerm.all({ term: normalizeTerm(query), crfTable, vocabulary: vocabularyId });
        const candidates = exact.length ? exact : byTerm.all({ term: questionTerm(query), crfTable, vocabulary: vocabularyId });
        if (candidates.length === 1) return { status: "found", entry: readEntry(candidates[0]) };
        if (candidates.length === 0) return { status: "not_found" };
        return {
          status: "ambiguous",
          candidates: candidates.slice(0, 20).map(({ concept_code, label }) => ({ conceptCode: concept_code, label })),
          truncated: candidates.length > 20,
        };
      },
      entries: () => db.prepare(`${fieldSelection} WHERE c.vocabulary_id = ? ORDER BY c.concept_id`).all(vocabularyId).map(readEntry),
      exportVocabulary(chineseLanguageId) {
        db.exec("BEGIN");
        try {
          return omopVocabulary(db, chineseLanguageId);
        } finally {
          db.exec("COMMIT");
        }
      },
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
