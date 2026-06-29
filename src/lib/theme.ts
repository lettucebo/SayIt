import { load } from "@tauri-apps/plugin-store";
import { THEME_MODE_VALUES, type ThemeMode } from "../types/settings";

const STORE_NAME = "settings.json";
const THEME_STORE_KEY = "themeMode";
// 同步快取，供 HTML inline script 在首次繪製前讀取，避免閃色
const THEME_LOCAL_KEY = "sayit-theme-mode";
export const DEFAULT_THEME_MODE: ThemeMode = "system";

let mediaQuery: MediaQueryList | null = null;
let systemListener: ((event: MediaQueryListEvent) => void) | null = null;
let activeMode: ThemeMode = DEFAULT_THEME_MODE;

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (THEME_MODE_VALUES as readonly string[]).includes(value)
  );
}

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (prefersDark() ? "dark" : "light") : mode;
}

// 只在 system 模式時掛系統偏好監聽，其餘模式移除，避免覆寫使用者選擇
function ensureSystemListener(mode: ThemeMode): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  if (mode === "system") {
    mediaQuery ??= window.matchMedia("(prefers-color-scheme: dark)");
    if (!systemListener) {
      systemListener = () => {
        if (activeMode === "system") {
          document.documentElement.classList.toggle("dark", prefersDark());
        }
      };
      mediaQuery.addEventListener("change", systemListener);
    }
  } else if (mediaQuery && systemListener) {
    mediaQuery.removeEventListener("change", systemListener);
    systemListener = null;
  }
}

// 套用主題：toggle <html>.dark（style.css 的 :root 為淺色、.dark 為深色）
export function applyTheme(mode: ThemeMode): void {
  activeMode = mode;
  document.documentElement.classList.toggle("dark", resolveTheme(mode) === "dark");
  try {
    localStorage.setItem(THEME_LOCAL_KEY, mode);
  } catch {
    // localStorage 不可用時略過快取，不影響套用
  }
  ensureSystemListener(mode);
}

// mount 前盡早讀取持久化主題並套用，避免閃白
export async function initThemeFromStore(): Promise<ThemeMode> {
  let mode = DEFAULT_THEME_MODE;
  try {
    const store = await load(STORE_NAME);
    const saved = await store.get<ThemeMode>(THEME_STORE_KEY);
    if (isThemeMode(saved)) {
      mode = saved;
    }
  } catch {
    // 讀取失敗時沿用預設（system），不阻斷啟動
  }
  applyTheme(mode);
  return mode;
}
