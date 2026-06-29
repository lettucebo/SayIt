import { load } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { THEME_MODE_VALUES, type ThemeMode } from "../types/settings";

const STORE_NAME = "settings.json";
const THEME_STORE_KEY = "themeMode";
// 同步快取，供 HTML inline script 在首次繪製前讀取，避免閃色
const THEME_LOCAL_KEY = "sayit-theme-mode";
export const DEFAULT_THEME_MODE: ThemeMode = "system";

let mediaQuery: MediaQueryList | null = null;
let systemListener: ((event: MediaQueryListEvent) => void) | null = null;
let activeMode: ThemeMode = DEFAULT_THEME_MODE;

// OS 外觀以 Tauri 視窗主題 API 為權威來源（跨平台一致）；
// 透明的 HUD WebView 在 Windows 下 CSS matchMedia 不一定反映 OS 外觀，
// 故快取 Tauri 回報的 OS 主題，matchMedia 僅作為非 Tauri / null 時的 fallback。
let osThemeDark: boolean | null = null;
let osWatcherInit = false;

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (THEME_MODE_VALUES as readonly string[]).includes(value)
  );
}

function prefersDark(): boolean {
  if (osThemeDark !== null) return osThemeDark;
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (prefersDark() ? "dark" : "light") : mode;
}

// 以 Tauri 視窗主題 API 取得權威 OS 外觀，快取供同步的 applyTheme 使用
async function refreshOsTheme(): Promise<void> {
  try {
    const t = await getCurrentWindow().theme();
    if (t === "dark") osThemeDark = true;
    else if (t === "light") osThemeDark = false;
    // null（如舊版 macOS）→ 維持原值，改用 matchMedia fallback
  } catch {
    // 非 Tauri 環境或無權限：維持 null，改用 matchMedia fallback
  }
}

// 訂閱 OS 外觀變更（system 模式時即時重新套用），全程僅訂閱一次
async function ensureOsThemeWatcher(): Promise<void> {
  if (osWatcherInit) return;
  osWatcherInit = true;
  try {
    await getCurrentWindow().onThemeChanged(({ payload }) => {
      osThemeDark = payload === "dark";
      if (activeMode === "system") {
        document.documentElement.classList.toggle("dark", osThemeDark);
      }
    });
  } catch {
    osWatcherInit = false; // 失敗允許之後重試
  }
}

// 只在 system 模式時掛系統偏好監聽（matchMedia fallback），其餘模式移除
function ensureSystemListener(mode: ThemeMode): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  if (mode === "system") {
    mediaQuery ??= window.matchMedia("(prefers-color-scheme: dark)");
    if (!systemListener) {
      systemListener = () => {
        // Tauri onThemeChanged 為主；此處僅在無權威值時 fallback
        if (activeMode === "system" && osThemeDark === null) {
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
  // 先取得權威 OS 主題並訂閱變更，確保 system 模式在所有視窗解析一致
  await refreshOsTheme();
  void ensureOsThemeWatcher();

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
