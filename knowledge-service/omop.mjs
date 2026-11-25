import { createHash } from "node:crypto";

export const vocabularyId = "KADY_CRF";
export const englishLanguageId = 4180186;
const csvColumns = {
  VOCABULARY: ["vocabulary_id", "vocabulary_name", "vocabulary_reference", "vocabulary_version", "vocabulary_concept_id"],
  CONCEPT: [
    "concept_id", "concept_name", "domain_id", "vocabulary_id", "concept_class_id", "standard_concept",
    "concept_code", "valid_start_date", "valid_end_date", "invalid_reason",
  ],
  CONCEPT_SYNONYM: ["concept_id", "concept_synonym_name", "language_concept_id"],
  CONCEPT_RELATIONSHIP: [
    "concept_id_1", "concept_id_2", "relationship_id", "valid_start_date", "valid_end_date", "invalid_reason",
  ],
};

export const omopTables = `
  CREATE TABLE IF NOT EXISTS VOCABULARY (
    vocabulary_id TEXT PRIMARY KEY,
    vocabulary_name TEXT NOT NULL,
    vocabulary_reference TEXT,
    vocabulary_version TEXT,
    vocabulary_concept_id INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS CONCEPT (
    concept_id INTEGER PRIMARY KEY,
    concept_name TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    vocabulary_id TEXT NOT NULL REFERENCES VOCABULARY(vocabulary_id),
    concept_class_id TEXT NOT NULL,
    standard_concept TEXT CHECK (standard_concept IN ('S', 'C')),
    concept_code TEXT NOT NULL,
    valid_start_date TEXT NOT NULL,
    valid_end_date TEXT NOT NULL,
    invalid_reason TEXT CHECK (invalid_reason IN ('D', 'U')),
    UNIQUE (vocabulary_id, concept_code),
    CHECK (vocabulary_id <> '${vocabularyId}' OR
      (concept_id BETWEEN 2000000001 AND 2147483647 AND standard_concept IS NULL))
  ) STRICT;

  CREATE TABLE IF NOT EXISTS CONCEPT_SYNONYM (
    concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    concept_synonym_name TEXT NOT NULL,
    language_concept_id INTEGER NOT NULL,
    PRIMARY KEY (concept_id, concept_synonym_name, language_concept_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS CONCEPT_RELATIONSHIP (
    concept_id_1 INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    concept_id_2 INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    relationship_id TEXT NOT NULL,
    valid_start_date TEXT NOT NULL,
    valid_end_date TEXT NOT NULL,
    invalid_reason TEXT CHECK (invalid_reason IN ('D', 'U')),
    PRIMARY KEY (concept_id_1, concept_id_2, relationship_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS DOMAIN (
    domain_id TEXT PRIMARY KEY,
    domain_name TEXT NOT NULL,
    domain_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS CONCEPT_CLASS (
    concept_class_id TEXT PRIMARY KEY,
    concept_class_name TEXT NOT NULL,
    concept_class_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS RELATIONSHIP (
    relationship_id TEXT PRIMARY KEY,
    relationship_name TEXT NOT NULL,
    is_hierarchical TEXT NOT NULL,
    defines_ancestry TEXT NOT NULL,
    reverse_relationship_id TEXT NOT NULL,
    relationship_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS CONCEPT_ANCESTOR (
    ancestor_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    descendant_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    min_levels_of_separation INTEGER NOT NULL,
    max_levels_of_separation INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS SOURCE_TO_CONCEPT_MAP (
    source_code TEXT NOT NULL,
    source_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    source_vocabulary_id TEXT NOT NULL,
    source_code_description TEXT,
    target_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    target_vocabulary_id TEXT NOT NULL REFERENCES VOCABULARY(vocabulary_id),
    valid_start_date TEXT NOT NULL,
    valid_end_date TEXT NOT NULL,
    invalid_reason TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS DRUG_STRENGTH (
    drug_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    ingredient_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    amount_value REAL,
    amount_unit_concept_id INTEGER REFERENCES CONCEPT(concept_id),
    numerator_value REAL,
    numerator_unit_concept_id INTEGER REFERENCES CONCEPT(concept_id),
    denominator_value REAL,
    denominator_unit_concept_id INTEGER REFERENCES CONCEPT(concept_id),
    box_size INTEGER,
    valid_start_date TEXT NOT NULL,
    valid_end_date TEXT NOT NULL,
    invalid_reason TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS PACK_CONTENT (
    pack_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    drug_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    amount INTEGER,
    box_size INTEGER
  ) STRICT;

  CREATE TABLE IF NOT EXISTS CONCEPT_METADATA (
    concept_id INTEGER REFERENCES CONCEPT(concept_id),
    concept_category TEXT,
    reuse_status TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS CONCEPT_RELATIONSHIP_METADATA (
    concept_id_1 INTEGER NOT NULL,
    concept_id_2 INTEGER NOT NULL,
    relationship_id TEXT NOT NULL REFERENCES RELATIONSHIP(relationship_id),
    relationship_predicate_id TEXT,
    relationship_group INTEGER,
    mapping_source TEXT,
    confidence REAL,
    mapping_tool TEXT,
    mapper TEXT,
    reviewer TEXT,
    FOREIGN KEY (concept_id_1, concept_id_2, relationship_id)
      REFERENCES CONCEPT_RELATIONSHIP(concept_id_1, concept_id_2, relationship_id)
  ) STRICT;

  -- The last two tables are OMOP RESULTS tables in the same local SQLite database.
  CREATE TABLE IF NOT EXISTS COHORT (
    cohort_definition_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    cohort_start_date TEXT NOT NULL,
    cohort_end_date TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS COHORT_DEFINITION (
    cohort_definition_id INTEGER NOT NULL,
    cohort_definition_name TEXT NOT NULL,
    cohort_definition_description TEXT,
    definition_type_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    cohort_definition_syntax TEXT,
    subject_concept_id INTEGER NOT NULL REFERENCES CONCEPT(concept_id),
    cohort_initiation_date TEXT
  ) STRICT;
`;

export function omopVocabulary(db, chineseLanguageId = 0) {
  const CONCEPT = db.prepare("SELECT * FROM CONCEPT WHERE vocabulary_id = ? ORDER BY concept_id").all(vocabularyId);
  const CONCEPT_SYNONYM = db.prepare(`
    SELECT s.* FROM CONCEPT_SYNONYM AS s JOIN CONCEPT AS c USING (concept_id)
    WHERE c.vocabulary_id = ? ORDER BY s.concept_id, s.rowid
  `).all(vocabularyId);
  for (const row of CONCEPT_SYNONYM) {
    if (row.language_concept_id === 0 && /\p{Script=Han}/u.test(row.concept_synonym_name)) {
      row.language_concept_id = chineseLanguageId;
    }
  }
  const fingerprint = createHash("sha256").update(JSON.stringify([CONCEPT, CONCEPT_SYNONYM])).digest("hex");

  return {
    VOCABULARY: db.prepare("SELECT * FROM VOCABULARY WHERE vocabulary_id = ?").all(vocabularyId).map((row) => ({
      ...row, vocabulary_version: `kady-crf-${fingerprint.slice(0, 16)}`,
    })),
    CONCEPT,
    CONCEPT_SYNONYM,
    CONCEPT_RELATIONSHIP: db.prepare(`
      SELECT r.* FROM CONCEPT_RELATIONSHIP AS r
      JOIN CONCEPT AS source ON r.concept_id_1 = source.concept_id
      JOIN CONCEPT AS target ON r.concept_id_2 = target.concept_id
      WHERE source.vocabulary_id = :vocabulary OR target.vocabulary_id = :vocabulary
      ORDER BY r.concept_id_1, r.concept_id_2, r.relationship_id
    `).all({ vocabulary: vocabularyId }),
  };
}

export function vocabularyCsv(tables) {
  const files = {};
  for (const [name, rows] of Object.entries(tables)) {
    const columns = csvColumns[name];
    const values = rows.map((row) => columns.map((column) => {
      const value = row[column];
      return typeof value === "string" ? `"${value.replaceAll('"', '""')}"` : (value ?? "");
    }).join(","));
    files[`${name}.csv`] = [columns.join(","), ...values, ""].join("\r\n");
  }
  return files;
}
