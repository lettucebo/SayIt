import {
  findWhisperModelConfig,
  findLlmModelConfig,
  DEFAULT_WHISPER_MODEL_ID,
  DEFAULT_LLM_MODEL_ID,
} from "./modelRegistry";

const WHISPER_MIN_BILLING_MS = 10_000;

/**
 * 計算 Whisper API 費用上限。
 * Groq 最低計費 10 秒/次，不足 10 秒一律按 10 秒算。
 * 從 modelRegistry 查表取得對應模型的每小時費率。
 *
 * 非 Whisper 系模型（如 Gemini 與 Preview 中的 MAI-Transcribe）不套用 Groq
 * 每小時計費。一律回 0 表示「未追蹤」——捏造費率會在 Dashboard 顯示錯誤金額。
 * 此判斷刻意放在這裡（而非各呼叫點），確保即時轉錄與歷史重新辨識兩條路徑一致。
 */
export function calculateWhisperCostCeiling(
  audioDurationMs: number,
  modelId: string = DEFAULT_WHISPER_MODEL_ID,
): number {
  const config = findWhisperModelConfig(modelId);
  // 查無設定且不是 whisper 系 → 非 Whisper provider，成本未追蹤
  if (!config && !modelId.startsWith("whisper")) return 0;
  const costPerHour = config?.costPerHour ?? 0.111;
  const billedMs = Math.max(audioDurationMs, WHISPER_MIN_BILLING_MS);
  return (billedMs / 3_600_000) * costPerHour;
}

/**
 * 計算 Chat LLM API 費用上限。
 * 全部 token 按較貴的價格算（input vs output 取大），保證是上限。
 */
export function calculateChatCostCeiling(
  totalTokens: number,
  modelId: string = DEFAULT_LLM_MODEL_ID,
): number {
  const config = findLlmModelConfig(modelId);
  // fallback 取全 registry 最貴的 outputCostPerMillion（gemini-3.1-pro-preview
  // $12/M，<200k tier）維持「保證是上限」的不變量——查不到 config 時（如遺留的
  // 死 model id）不會低估。
  const maxCostPerToken = config
    ? Math.max(config.inputCostPerMillion, config.outputCostPerMillion) /
      1_000_000
    : 0.000012;
  return totalTokens * maxCostPerToken;
}
