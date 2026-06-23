import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  buildExportFile,
} from "../../src/lib/vocabularyTransfer";
import type { VocabularyExportEntry } from "../../src/types/vocabulary";

const sampleEntries: VocabularyExportEntry[] = [
  { term: "Groq", weight: 30, source: "manual" },
  { term: "Tauri", weight: 12, source: "ai" },
];

describe("buildExportFile", () => {
  it("應產生帶 format/version/exportedAt 的物件", () => {
    const file = buildExportFile(sampleEntries, "2026-06-09T00:00:00.000Z");
    expect(file.format).toBe(EXPORT_FORMAT);
    expect(file.version).toBe(EXPORT_VERSION);
    expect(file.exportedAt).toBe("2026-06-09T00:00:00.000Z");
    expect(file.terms).toHaveLength(2);
  });

  it("匯出時正規化非法 weight/source", () => {
    const file = buildExportFile(
      [{ term: "X", weight: -5, source: "bogus" as never }],
      "2026-06-09T00:00:00.000Z",
    );
    expect(file.terms[0].weight).toBe(1);
    expect(file.terms[0].source).toBe("manual");
  });
});
