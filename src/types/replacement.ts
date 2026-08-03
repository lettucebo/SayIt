/**
 * #55 Word Replacements：轉錄後 deterministic（確定性）修正規則。
 * 存 `tauri-plugin-store`（不進 SQLite），與 LLM 後處理 prompt 互補：
 * prompt 負責泛化推理，規則表負責個人固定的高頻錯誤（專有名詞、品牌、術語）。
 */

/** 套用時機：LLM 整理前、整理後、或兩者皆套用。 */
export type ReplacementTiming = "beforeAI" | "afterAI" | "both";

export interface ReplacementRule {
  id: string;
  /** 多變體來源寫法（錯誤／聽錯），任一命中即取代為 `replacement`。 */
  patterns: string[];
  /** 目標正確寫法；正則規則可含 `$1` 等 capture group。 */
  replacement: string;
  /** true=`patterns` 視為正則；false=字面（大小寫不敏感 + 詞界）。 */
  isRegex: boolean;
  timing: ReplacementTiming;
  enabled: boolean;
  /**
   * 建立時間，ISO 8601 UTC 字串（`new Date().toISOString()`，帶 `Z`）。
   * 與 SQLite 的 `created_at`（無時區後綴、需自行補 "Z"）不同，可直接 `new Date()` 解析。
   * 本功能推出前建立的規則沒有此欄位 → 由 `migrateRuleCreatedAt()` 一次性補寫。
   */
  createdAt: string;
}
