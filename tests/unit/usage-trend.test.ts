import { describe, expect, it } from "vitest";
import {
  buildDailyUsageSeries,
  getLocalDayUtcRangeForSqlite,
} from "../../src/lib/usageTrend";
import type { DailyUsageTrend } from "../../src/types/transcription";

function toLocalKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

describe("buildDailyUsageSeries", () => {
  it("空輸入回傳空陣列（保留圖表空狀態）", () => {
    expect(buildDailyUsageSeries([], 14)).toEqual([]);
  });

  it("days <= 0 回傳空陣列", () => {
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 1, totalChars: 10 },
    ];
    expect(buildDailyUsageSeries(rows, 0)).toEqual([]);
    expect(buildDailyUsageSeries(rows, -3)).toEqual([]);
  });

  it("補零成長度為 days 的升冪連續區間，末日為 endDate", () => {
    const endDate = new Date(2026, 2, 5); // 2026-03-05 本地
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 5, totalChars: 250 },
    ];
    const series = buildDailyUsageSeries(rows, 7, endDate);

    expect(series).toHaveLength(7);
    // 升冪
    const dates = series.map((d) => d.date);
    expect(dates).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
    ]);
    expect(series[series.length - 1]).toEqual({
      date: "2026-03-05",
      count: 5,
      totalChars: 250,
    });
  });

  it("缺席日補 0、命中日正確映射 count/totalChars", () => {
    const endDate = new Date(2026, 2, 5);
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 5, totalChars: 250 },
      { date: "2026-03-01", count: 3, totalChars: 120 },
    ];
    const series = buildDailyUsageSeries(rows, 7, endDate);
    const byDate = new Map(series.map((d) => [d.date, d]));

    expect(byDate.get("2026-03-01")).toEqual({
      date: "2026-03-01",
      count: 3,
      totalChars: 120,
    });
    expect(byDate.get("2026-03-05")).toEqual({
      date: "2026-03-05",
      count: 5,
      totalChars: 250,
    });
    // 其餘 5 天皆為 0
    const zeroDays = series.filter(
      (d) => d.date !== "2026-03-01" && d.date !== "2026-03-05",
    );
    expect(zeroDays).toHaveLength(5);
    for (const day of zeroDays) {
      expect(day.count).toBe(0);
      expect(day.totalChars).toBe(0);
    }
  });

  it("跨月邊界產生正確的連續日期", () => {
    const endDate = new Date(2026, 2, 2); // 2026-03-02
    const series = buildDailyUsageSeries(
      [{ date: "2026-03-02", count: 1, totalChars: 4 }],
      5,
      endDate,
    );
    expect(series.map((d) => d.date)).toEqual([
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("忽略落在區間外的資料列", () => {
    const endDate = new Date(2026, 2, 5);
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 5, totalChars: 250 },
      { date: "2026-02-20", count: 9, totalChars: 999 }, // 區間外
    ];
    const series = buildDailyUsageSeries(rows, 7, endDate);

    expect(series).toHaveLength(7);
    expect(series.some((d) => d.date === "2026-02-20")).toBe(false);
    // 區間外資料不影響總和
    const total = series.reduce((sum, d) => sum + d.count, 0);
    expect(total).toBe(5);
  });

  it("預設 endDate 為今天，末日為今天的本地日期", () => {
    const series = buildDailyUsageSeries(
      [{ date: toLocalKey(new Date()), count: 2, totalChars: 8 }],
      14,
    );
    expect(series).toHaveLength(14);
    expect(series[series.length - 1].date).toBe(toLocalKey(new Date()));
    expect(series[series.length - 1].count).toBe(2);
  });
});

describe("getLocalDayUtcRangeForSqlite", () => {
  const SQLITE_UTC_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  // 把 SQLite UTC 字串（"YYYY-MM-DD HH:MM:SS"，UTC）轉回可比較的 epoch。
  const sqliteUtcToEpoch = (s: string) =>
    new Date(`${s.replace(" ", "T")}Z`).getTime();

  it("[P1] 回傳格式為 SQLite datetime('now') 對齊的 'YYYY-MM-DD HH:MM:SS'（UTC，秒精度）", () => {
    const [start, end] = getLocalDayUtcRangeForSqlite(new Date(2026, 5, 15, 13, 42, 7));
    expect(start).toMatch(SQLITE_UTC_PATTERN);
    expect(end).toMatch(SQLITE_UTC_PATTERN);
  });

  it("[P1] start/end 對應到 now 的本地午夜與隔日本地午夜（TZ 無關的往返驗證）", () => {
    const now = new Date(2026, 5, 15, 13, 42, 7); // 本地某時刻
    const [start, end] = getLocalDayUtcRangeForSqlite(now);

    const expectedLocalMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const expectedNextLocalMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).getTime();

    expect(sqliteUtcToEpoch(start)).toBe(expectedLocalMidnight);
    expect(sqliteUtcToEpoch(end)).toBe(expectedNextLocalMidnight);
  });

  it("[P1] 半開區間 [start, end)：本地當日午夜納入、隔日午夜排除", () => {
    const now = new Date(2026, 5, 15, 9, 0, 0);
    const [start, end] = getLocalDayUtcRangeForSqlite(now);
    const startEpoch = sqliteUtcToEpoch(start);
    const endEpoch = sqliteUtcToEpoch(end);

    const localMidnight = new Date(2026, 5, 15).getTime();
    const justBeforeMidnight = localMidnight - 1;
    const midDay = new Date(2026, 5, 15, 12, 0, 0).getTime();
    const nextMidnight = new Date(2026, 5, 16).getTime();

    // 當日午夜與白天落在區間內
    expect(localMidnight >= startEpoch && localMidnight < endEpoch).toBe(true);
    expect(midDay >= startEpoch && midDay < endEpoch).toBe(true);
    // 前一刻與隔日午夜落在區間外
    expect(justBeforeMidnight >= startEpoch && justBeforeMidnight < endEpoch).toBe(false);
    expect(nextMidnight >= startEpoch && nextMidnight < endEpoch).toBe(false);
  });

  it("[P2] start 字典序小於 end（可安全用於字串範圍比較）", () => {
    const [start, end] = getLocalDayUtcRangeForSqlite(new Date(2026, 0, 1, 0, 0, 0));
    expect(start < end).toBe(true);
  });

  it("[P2] 跨月/跨年邊界：12/31 當日隔日午夜為次年 1/1", () => {
    const now = new Date(2026, 11, 31, 23, 30, 0); // 本地 2026-12-31
    const [, end] = getLocalDayUtcRangeForSqlite(now);
    expect(sqliteUtcToEpoch(end)).toBe(new Date(2027, 0, 1).getTime());
  });
});
