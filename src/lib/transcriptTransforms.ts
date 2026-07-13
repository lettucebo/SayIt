/**
 * 轉錄原文落地前的共用文字轉換（#39）。
 *
 * 抽成獨立純函式（而非藏在某個 store 內）以便主路徑、重送、歷史重新辨識
 * 三條落地路徑共用同一套邏輯，並可獨立單元測試。
 */
import { convertSimplifiedToTraditional } from "./simplifiedToTraditional";

/**
 * 解析「有效轉譯語言」：使用者選 auto 時回退到介面語言，其餘沿用所選轉譯語言。
 */
export function resolveEffectiveTranscriptionLocale(
  transcriptionLocale: string,
  uiLocale: string,
): string {
  return transcriptionLocale === "auto" ? uiLocale : transcriptionLocale;
}

/**
 * 轉錄原文落地前的文字轉換。
 * 目前只做：有效轉譯語言為繁中（zh-TW）時，把 Whisper 的簡體輸出轉成繁體。
 * 其餘語言（或空字串）原樣返回。
 */
export function applyTranscriptTextTransforms(
  rawText: string,
  effectiveLocale: string,
): string {
  if (!rawText) return rawText;
  return effectiveLocale === "zh-TW"
    ? convertSimplifiedToTraditional(rawText)
    : rawText;
}
