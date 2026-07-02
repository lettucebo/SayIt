import type { DailyUsageTrend } from "../types/transcription";

/**
 * 計算「本地今天」的起訖時刻，轉為與 `api_usage.created_at`（SQLite `datetime('now')`，
 * UTC、格式 "YYYY-MM-DD HH:MM:SS"）相同格式的 UTC 字串，供 daily-quota range 查詢使用。
 *
 * 改用 `created_at >= start AND created_at < end` 取代 `DATE(created_at, 'localtime') = ...`，
 * 避免函式包裹欄位導致索引失效，同時維持「本地日」語意不變（perf 稽核 F7）。
 * start / end 皆以 `new Date(y, m, d[+1])` 取「本地午夜」瞬間再 `toISOString()` 轉 UTC；
 * end 必須是「隔日的本地午夜」而非 start + 24h——DST 轉換日的本地日為 23/25 小時，
 * 用固定 24h 會使區間邊界偏移一小時（見 code review Issue 2）。字串採固定寬度零補的
 * UTC 格式，字典序即等於時間序，可安全用於範圍比較。
 */
export function getLocalDayUtcRangeForSqlite(
  now: Date = new Date(),
): [string, string] {
  const localStartOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  // 隔日本地午夜（非 start + 24h）：DST 日的本地日長度為 23/25 小時。
  const localEndOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0,
  );
  const toSqliteUtcDatetime = (date: Date) =>
    date.toISOString().slice(0, 19).replace("T", " ");
  return [
    toSqliteUtcDatetime(localStartOfDay),
    toSqliteUtcDatetime(localEndOfDay),
  ];
}

// 與 DAILY_USAGE_TREND_SQL 的 DATE(..., 'localtime') 對齊：用本地時間組 YYYY-MM-DD，
// 不可用 toISOString()（UTC 會差一天，造成補零時對不到實際使用日）。
function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 將「只含有使用記錄日期」的趨勢資料補零成連續區間。
 *
 * 回傳一個長度為 `days` 的升冪序列（從 days-1 天前到 endDate 當天），
 * 缺席的日期以 count=0 / totalChars=0 補上，確保趨勢圖 X 軸固定顯示完整區間，
 * 避免資料稀疏時出現重複日期標籤與誤導性的斜線內插。
 *
 * 完全沒有任何使用記錄時回傳空陣列，讓圖表維持「尚無使用記錄」空狀態。
 */
export function buildDailyUsageSeries(
  rows: DailyUsageTrend[],
  days: number,
  endDate: Date = new Date(),
): DailyUsageTrend[] {
  if (rows.length === 0 || days <= 0) return [];

  const byDate = new Map<string, DailyUsageTrend>();
  for (const row of rows) {
    byDate.set(row.date, row);
  }

  const base = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
  );

  const series: DailyUsageTrend[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const current = new Date(base);
    current.setDate(base.getDate() - offset);
    const key = toLocalDateKey(current);
    const existing = byDate.get(key);
    series.push({
      date: key,
      count: existing?.count ?? 0,
      totalChars: existing?.totalChars ?? 0,
    });
  }

  return series;
}
