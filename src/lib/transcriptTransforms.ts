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

interface TextSegment {
  text: string;
  protectedFromConversion: boolean;
}

function expandRegexReplacement(
  template: string,
  match: string,
  captures: readonly unknown[],
  fullText: string,
  offset: number,
  groups?: Record<string, string | undefined>,
): string {
  return template.replace(/\$(\$|&|`|'|<[^>]+>|\d{1,2})/g, (token, key) => {
    if (key === "$") return "$";
    if (key === "&") return match;
    if (key === "`") return fullText.slice(0, offset);
    if (key === "'") return fullText.slice(offset + match.length);
    if (key.startsWith("<") && key.endsWith(">")) {
      if (!groups) return token;
      const name = key.slice(1, -1);
      return groups[name] ?? "";
    }

    const captureIndex = Number(key);
    if (key.length === 2 && captureIndex > captures.length) {
      const firstCaptureIndex = Number(key[0]);
      if (firstCaptureIndex >= 1 && firstCaptureIndex <= captures.length) {
        return `${captures[firstCaptureIndex - 1] ?? ""}${key[1]}`;
      }
      return token;
    }
    if (captureIndex < 1 || captureIndex > captures.length) return token;
    return `${captures[captureIndex - 1] ?? ""}`;
  });
}

function replaceSegmentWithProtectedOutput(
  segment: TextSegment,
  matcher: RegExp,
  replacement: string,
  isRegex: boolean,
): TextSegment[] {
  const next: TextSegment[] = [];
  let cursor = 0;
  let changed = false;
  segment.text.replace(matcher, (...args: unknown[]) => {
    const match = String(args[0]);
    const lastArg = args[args.length - 1];
    const hasGroups =
      typeof lastArg === "object" && lastArg !== null;
    const offset = args[args.length - (hasGroups ? 3 : 2)] as number;
    const fullText = args[args.length - (hasGroups ? 2 : 1)] as string;
    const captures = args.slice(1, hasGroups ? -3 : -2);
    const groups = hasGroups
      ? (lastArg as Record<string, string | undefined>)
      : undefined;

    if (offset > cursor) {
      next.push({
        text: segment.text.slice(cursor, offset),
        protectedFromConversion: segment.protectedFromConversion,
      });
    }
    next.push({
      text: isRegex
        ? expandRegexReplacement(
            replacement,
            match,
            captures,
            fullText,
            offset,
            groups,
          )
        : replacement,
      protectedFromConversion: true,
    });
    cursor = offset + match.length;
    changed = true;
    return match;
  });

  if (!changed) return [segment];
  if (cursor < segment.text.length) {
    next.push({
      text: segment.text.slice(cursor),
      protectedFromConversion: segment.protectedFromConversion,
    });
  }
  return next;
}

function applyWordReplacementSegments(
  text: string,
  rules: readonly ReplacementRule[],
  phase: Exclude<ReplacementTiming, "both">,
): TextSegment[] {
  let segmentList: TextSegment[] = [
    { text, protectedFromConversion: false },
  ];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.timing !== phase && rule.timing !== "both") continue;
    for (const pattern of rule.patterns) {
      if (!pattern) continue;
      try {
        const matcher = rule.isRegex
          ? new RegExp(pattern, "g")
          : buildLiteralPattern(pattern);
        segmentList = segmentList.flatMap((segment) =>
          replaceSegmentWithProtectedOutput(
            segment,
            matcher,
            rule.replacement,
            rule.isRegex,
          ),
        );
      } catch {
        // 無效正則：略過此 pattern，不影響其餘規則與主流程
      }
    }
  }
  return segmentList;
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

/**
 * AI 最終輸出落地前的共用轉換。
 *
 * 順序刻意是：afterAI 取代 → guarded 簡→繁。先跑 afterAI 可保留既有簡體
 * source pattern 的匹配行為；後續 OpenCC 只轉換非 replacement 產生的片段，
 * 避免改寫使用者明確設定的 replacement 文字。
 */
export async function finalizeOutputText(
  text: string,
  replacementRules: readonly ReplacementRule[] = [],
  options: { convertSimplifiedToTraditional?: boolean } = {},
): Promise<string> {
  if (!text) return text;
  const segmentList = applyWordReplacementSegments(
    text,
    replacementRules,
    "afterAI",
  );
  if (!options.convertSimplifiedToTraditional) {
    return segmentList.map((segment) => segment.text).join("");
  }
  const convertedSegmentList = await Promise.all(
    segmentList.map(async (segment) =>
      segment.protectedFromConversion
        ? segment.text
        : await convertSimplifiedToTraditional(segment.text),
    ),
  );
  return convertedSegmentList.join("");
}
