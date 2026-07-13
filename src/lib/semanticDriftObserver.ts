/**
 * a5-B「shadow 觀測」：把既有但未接線的 `detectSemanticDrift` 接進 AI 整理流程，
 * 但**完全不改變任何貼上/退回行為**——只在偵測到語意漂移時記一筆 content-free log。
 *
 * 背景：`detectSemanticDrift` 是字元 bigram 包含率、非語意相似度；0.2 門檻未證明
 * 適用中文「口語→書面語」改寫（合法改寫也可能低於門檻 → false positive）。因此在
 * 蒐集到 labeled corpus、量化 false-positive 率並通過 promotion gate 前，只做觀測、
 * 不主動退回。log 僅含 content-free 欄位（ratio、長度、locale、prompt 模式、
 * provider/model、would-fallback），**絕不記文字內容**（可能被 captureError 上報）。
 */
import { detectSemanticDrift } from "./hallucinationDetector";
import { logInfoLine } from "./logger";

export type SemanticDriftPath = "main" | "resend" | "history";

export interface SemanticDriftObservationMeta {
  locale?: string;
  promptMode?: string;
  provider?: string;
  model?: string;
}

/**
 * 觀測一次整理的語意漂移。偵測到漂移（若啟用主動退回則會 fallback）時記一筆 log。
 * enhanced === raw（例如長度爆炸已 fallback 回原文）時 overlap=1、天然不觸發。
 */
export function observeSemanticDrift(
  rawText: string,
  enhancedText: string,
  path: SemanticDriftPath,
  meta: SemanticDriftObservationMeta = {},
): void {
  const drift = detectSemanticDrift(rawText, enhancedText);
  if (!drift.isDrift) return;
  logInfoLine(
    `[semantic-drift-shadow] path=${path} ` +
      `overlapRatio=${drift.overlapRatio.toFixed(3)} ` +
      `rawLen=${rawText.length} enhancedLen=${enhancedText.length} ` +
      `locale=${meta.locale ?? "?"} promptMode=${meta.promptMode ?? "?"} ` +
      `provider=${meta.provider ?? "?"} model=${meta.model ?? "?"} ` +
      `wouldFallback=true`,
  );
}
