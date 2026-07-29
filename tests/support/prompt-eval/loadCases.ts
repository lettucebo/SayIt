/**
 * 讀取 prompt 評測集 fixture（#49）。
 *
 * 用 `fs` 直接讀 JSON 而非 `import`：fixture 是資料不是模組，避免綁定
 * `resolveJsonModule` 設定，也讓未來的獨立 runner 腳本能共用同一個 loader。
 *
 * JSON 讀進來只能用 `as` 轉型、沒有編譯期保護，因此這裡做一層輕量執行期驗證：
 * 壞掉的 fixture 要在**載入當下**指名檔案與案例失敗，而不是拖到斷言迴圈深處
 * 才炸出無法定位的錯誤。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_ASSERTION_KINDS, ALL_PHENOMENA } from "./types";
import type { PromptEvalCase, PromptEvalCaseFile } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, "../../fixtures/prompt-eval");

/** 已知的 fixture 檔名，依 L1 → L2 排序。 */
export const CASE_FILES = [
  "cases-l1-personal.json",
  "cases-l2-ml2021.json",
] as const;

const ASSERTION_KINDS = new Set<string>(ALL_ASSERTION_KINDS);
const PHENOMENA = new Set<string>(ALL_PHENOMENA);

function assertNonEmptyString(
  value: unknown,
  where: string,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `${where}：${field} 必須是非空字串，實際為 ${JSON.stringify(value)}`,
    );
  }
}

function validateCase(rawCase: unknown, where: string): PromptEvalCase {
  if (typeof rawCase !== "object" || rawCase === null) {
    throw new Error(`${where}：案例必須是物件`);
  }
  const candidate = rawCase as Record<string, unknown>;
  assertNonEmptyString(candidate.id, where, "id");
  const at = `${where} 案例 ${candidate.id}`;
  for (const field of ["input", "expected", "notes", "provenance", "source"]) {
    assertNonEmptyString(candidate[field], at, field);
  }

  if (!Array.isArray(candidate.phenomena) || candidate.phenomena.length === 0) {
    throw new Error(`${at}：phenomena 必須是非空陣列`);
  }
  for (const phenomenon of candidate.phenomena) {
    if (!PHENOMENA.has(String(phenomenon))) {
      throw new Error(`${at}：未知的 phenomenon「${String(phenomenon)}」`);
    }
  }

  if (
    !Array.isArray(candidate.assertions) ||
    candidate.assertions.length === 0
  ) {
    throw new Error(`${at}：assertions 必須是非空陣列`);
  }
  for (const assertion of candidate.assertions) {
    const kind = (assertion as { kind?: unknown } | null)?.kind;
    if (!ASSERTION_KINDS.has(String(kind))) {
      throw new Error(`${at}：未知的 assertion kind「${String(kind)}」`);
    }
  }

  return candidate as unknown as PromptEvalCase;
}

/** 讀取單一 fixture 檔並驗證其結構。 */
export function loadCaseFile(fileName: string): PromptEvalCaseFile {
  const path = resolve(FIXTURE_DIR, fileName);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `讀取 fixture ${fileName} 失敗：${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`fixture ${fileName}：頂層必須是物件`);
  }
  const file = parsed as Record<string, unknown>;
  assertNonEmptyString(file.source, `fixture ${fileName}`, "source");
  assertNonEmptyString(file.description, `fixture ${fileName}`, "description");
  assertNonEmptyString(file.license, `fixture ${fileName}`, "license");
  if (!Array.isArray(file.cases) || file.cases.length === 0) {
    throw new Error(`fixture ${fileName}：cases 必須是非空陣列`);
  }

  const cases = file.cases.map((rawCase) =>
    validateCase(rawCase, `fixture ${fileName}`),
  );
  return { ...(file as unknown as PromptEvalCaseFile), cases };
}

/** 讀取全部 fixture 檔並攤平成案例陣列。 */
export function loadAllCases(): PromptEvalCase[] {
  return CASE_FILES.flatMap((fileName) => loadCaseFile(fileName).cases);
}
