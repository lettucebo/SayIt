import type {
  VocabularyExportEntry,
  VocabularyExportFile,
  VocabularySource,
} from "../types/vocabulary";

export const EXPORT_FORMAT = "sayit-dictionary" as const;
export const EXPORT_VERSION = 1 as const;

const VALID_SOURCES: VocabularySource[] = ["manual", "ai"];

function normalizeWeight(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  const int = Math.floor(n);
  return int < 1 ? 1 : int;
}

function normalizeSource(value: unknown): VocabularySource {
  return VALID_SOURCES.includes(value as VocabularySource)
    ? (value as VocabularySource)
    : "manual";
}

/** 建立可序列化的匯出物件 */
export function buildExportFile(
  entries: VocabularyExportEntry[],
  exportedAt: string,
): VocabularyExportFile {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt,
    terms: entries.map((e) => ({
      term: e.term,
      weight: normalizeWeight(e.weight),
      source: normalizeSource(e.source),
    })),
  };
}
