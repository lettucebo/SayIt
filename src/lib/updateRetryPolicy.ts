/**
 * 自動更新「啟動檢查」失敗時的重試策略。
 *
 * 獨立於 `autoUpdater.ts` 是刻意的：`autoUpdater.ts` 會拉進
 * `@tauri-apps/plugin-updater`，故只在需要時動態 import；但重試排程必須在
 * 動態 import 失敗的 catch 路徑中也能使用，所以這裡只放無相依的純邏輯。
 */

/**
 * 檢查失敗時依序採用的重試延遲（毫秒）。
 *
 * 更新檢查刻意只在 App 啟動時做一次、不定時輪詢，但 `checkForAppUpdate()`
 * 會吞掉例外並回傳 `status: "error"`；若不重試，開機自啟時網路／DNS 尚未就緒
 * 就等於這個 App process 再也不會自動檢查更新（常駐工具可能數天不重啟）。
 * 因此僅在「失敗」時做有限次退避重試，成功後即停止。
 */
export const AUTO_CHECK_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];

/**
 * 取得第 `attempt` 次重試（0-based）該等待的毫秒數。
 * 重試次數用盡時回傳 `null`，呼叫端應停止重試。
 */
export function getAutoCheckRetryDelayMs(attempt: number): number | null {
  return AUTO_CHECK_RETRY_DELAYS_MS[attempt] ?? null;
}
