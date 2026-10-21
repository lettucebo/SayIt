// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOP_TERM_LIST_SQL } from "../../src/stores/useVocabularyStore";
import { createVocabularyEntry } from "../support/factories/vocabulary-factory";
import type { VocabularyEntry } from "../../src/types/vocabulary";

describe("TOP_TERM_LIST_SQL", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE vocabulary (
        id TEXT PRIMARY KEY,
        term TEXT NOT NULL UNIQUE,
        weight INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  });

  afterEach(() => db.close());

  function insert(entry: VocabularyEntry) {
    db.prepare(
      "INSERT INTO vocabulary (id, term, weight, source, created_at) VALUES ($id, $term, $weight, $source, $created_at)",
    ).run({
      $id: entry.id,
      $term: entry.term,
      $weight: entry.weight,
      $source: entry.source,
      $created_at: entry.createdAt,
    });
  }

  function topTerms(limit: number): string[] {
    return db.prepare(TOP_TERM_LIST_SQL).all({ $1: limit })
      .map((row) => row.term as string);
  }

  it("[P1] 低權重手動詞仍排在 50 個高權重 AI 詞之前", () => {
    for (let index = 0; index < 50; index++) {
      insert(createVocabularyEntry({
        term: `AI-${index}`,
        source: "ai",
        weight: 100,
        createdAt: "2026-03-01 00:00:00",
      }));
    }
    insert(createVocabularyEntry({
      term: "manual-new",
      source: "manual",
      weight: 1,
      createdAt: "2026-03-02 00:00:00",
    }));

    const result = topTerms(50);
    expect(result).toHaveLength(50);
    expect(result[0]).toBe("manual-new");
    expect(result.filter((term) => term.startsWith("AI-"))).toHaveLength(49);
  });

  it("[P1] 超過 50 個手動詞時依權重及建立時間截取，AI 詞不佔名額", () => {
    for (let index = 0; index < 49; index++) {
      insert(createVocabularyEntry({
        term: `manual-${index}`,
        source: "manual",
        weight: 100 - index,
        createdAt: "2026-03-01 00:00:00",
      }));
    }
    insert(createVocabularyEntry({
      term: "manual-older",
      source: "manual",
      weight: 1,
      createdAt: "2026-03-01 00:00:00",
    }));
    insert(createVocabularyEntry({
      term: "manual-newer",
      source: "manual",
      weight: 1,
      createdAt: "2026-03-02 00:00:00",
    }));
    insert(createVocabularyEntry({
      term: "AI-heavy",
      source: "ai",
      weight: 1000,
      createdAt: "2026-03-03 00:00:00",
    }));

    const result = topTerms(50);
    expect(result).toEqual([
      ...Array.from({ length: 49 }, (_, index) => `manual-${index}`),
      "manual-newer",
    ]);
  });

  it("[P1] 同來源內依 weight DESC、同權重依 created_at DESC", () => {
    insert(createVocabularyEntry({
      term: "manual-old",
      source: "manual",
      weight: 3,
      createdAt: "2026-03-01 00:00:00",
    }));
    insert(createVocabularyEntry({
      term: "manual-new",
      source: "manual",
      weight: 3,
      createdAt: "2026-03-02 00:00:00",
    }));
    insert(createVocabularyEntry({
      term: "manual-heavy",
      source: "manual",
      weight: 10,
      createdAt: "2026-02-01 00:00:00",
    }));
    insert(createVocabularyEntry({
      term: "AI-old",
      source: "ai",
      weight: 2,
      createdAt: "2026-03-01 00:00:00",
    }));
    insert(createVocabularyEntry({
      term: "AI-new",
      source: "ai",
      weight: 2,
      createdAt: "2026-03-02 00:00:00",
    }));

    expect(topTerms(5)).toEqual([
      "manual-heavy", "manual-new", "manual-old", "AI-new", "AI-old",
    ]);
  });

  it("[P1] 空字典不產生任何候選詞", () => {
    expect(topTerms(50)).toEqual([]);
  });
});
