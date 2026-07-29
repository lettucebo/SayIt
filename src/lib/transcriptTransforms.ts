/**
 * 轉錄原文落地前的共用文字轉換（#39）。
 *
 * 抽成獨立純函式（而非藏在某個 store 內）以便主路徑、重送、歷史重新辨識
 * 三條落地路徑共用同一套邏輯，並可獨立單元測試。
 */
import { convertSimplifiedToTraditional } from "./simplifiedToTraditional";
import type {
  ReplacementRule,
  ReplacementTiming,
} from "../types/replacement";

/**
 * 解析「有效轉譯語言」：使用者選 auto 時回退到介面語言，其餘沿用所選轉譯語言。
 */
export function resolveEffectiveTranscriptionLocale(
  transcriptionLocale: string,
  uiLocale: string,
): string {
  return transcriptionLocale === "auto" ? uiLocale : transcriptionLocale;
}

/** 將字面 pattern 轉義為安全的正則片段。 */
function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 為字面 pattern 組出比對用的正則。
 *
 * ASCII 詞界只在**該端點確實是 ASCII 字元**時才加：
 * - `cat` 兩端都是 ASCII → 兩側都加，才不會命中 category
 * - `客戶短` 兩端都是中文 → 兩側都不加。若無條件加前瞻，
 *   「Enjoy客戶短」的「客戶短」會因為前面是 `y` 而永遠比對不到——
 *   使用者在 UI 建的中文規則會在中英夾雜語句中默默失效。
 * - `C++` 開頭是 ASCII、結尾是符號 → 只加前側；`.NET` 反之
 */
function buildLiteralPattern(pattern: string): RegExp {
  const lookbehind = /^[A-Za-z0-9_]/.test(pattern) ? "(?<![A-Za-z0-9_])" : "";
  const lookahead = /[A-Za-z0-9_]$/.test(pattern) ? "(?![A-Za-z0-9_])" : "";
  return new RegExp(
    `${lookbehind}${escapeRegExp(pattern)}${lookahead}`,
    "giu",
  );
}

/**
 * #55：套用使用者維護的「取代規則」到單一階段（beforeAI / afterAI）。
 * 純函式——規則由呼叫端（store）提供，不在此讀取，維持依賴方向。
 * - 字面（isRegex=false）：大小寫不敏感 + ASCII identifier 邊界（避免 cat
 *   命中 category），同時支援中文精確子字串與 C++、C#、.NET 等符號術語；
 *   replacement 完全照字面輸出（不解析 $&、$1）。
 * - 正則（isRegex=true）：支援 capture group（replacement 可含 `$1`）；
 *   無效正則會被略過（fail-open，不中斷其餘規則與主流程）。
 */
export function applyWordReplacements(
  text: string,
  rules: readonly ReplacementRule[],
  phase: Exclude<ReplacementTiming, "both">,
): string {
  if (!text || rules.length === 0) return text;
  let result = text;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.timing !== phase && rule.timing !== "both") continue;
    for (const pattern of rule.patterns) {
      if (!pattern) continue;
      try {
        if (rule.isRegex) {
          // 正則：保留 $1 等 capture group 語意
          result = result.replace(new RegExp(pattern, "g"), rule.replacement);
        } else {
          // 字面：詞界只在 pattern 端點是 ASCII 時才加（見 buildLiteralPattern），
          // 支援中文精確子字串、C++、C#、.NET，且避免 cat 命中 category；
          // replacement 以函式回傳，確保完全照字面輸出，不被當成 $&、$1 等樣板。
          result = result.replace(
            buildLiteralPattern(pattern),
            () => rule.replacement,
          );
        }
      } catch {
        // 無效正則：略過此 pattern，不影響其餘規則與主流程
      }
    }
  }
  return result;
}

/**
 * 轉錄原文落地前的文字轉換。
 * 順序（#55）：beforeAI 取代 → 簡→繁（有效轉譯語言為 zh-TW 時）。
 * beforeAI 取代先跑，讓後續 OpenCC 與 LLM 讀到正確術語。
 * 非 zh-TW / 空字串仍同步解析，**不會**觸發 opencc 的惰性載入。
 */
export async function applyTranscriptTextTransforms(
  rawText: string,
  effectiveLocale: string,
  replacementRules: readonly ReplacementRule[] = [],
): Promise<string> {
  if (!rawText) return rawText;
  const replaced = applyWordReplacements(rawText, replacementRules, "beforeAI");
  return effectiveLocale === "zh-TW"
    ? await convertSimplifiedToTraditional(replaced)
    : replaced;
}
