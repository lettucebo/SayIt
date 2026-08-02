import type { TriggerMode } from "./index";

export type PresetTriggerKey =
  | "fn"
  | "option"
  | "rightOption"
  | "command"
  | "rightAlt"
  | "leftAlt"
  | "control"
  | "rightControl"
  | "shift";

export interface CustomTriggerKey {
  custom: { keycode: number };
}

export type ModifierFlag = "command" | "control" | "option" | "shift" | "fn";

export interface ComboTriggerKey {
  combo: { modifiers: ModifierFlag[]; keycode: number };
}

export type TriggerKey = PresetTriggerKey | CustomTriggerKey | ComboTriggerKey;

export function isPresetTriggerKey(key: TriggerKey): key is PresetTriggerKey {
  return typeof key === "string";
}

export function isCustomTriggerKey(key: TriggerKey): key is CustomTriggerKey {
  return typeof key === "object" && key !== null && "custom" in key;
}

export function isComboTriggerKey(key: TriggerKey): key is ComboTriggerKey {
  return typeof key === "object" && key !== null && "combo" in key;
}

export interface HotkeyConfig {
  triggerKey: TriggerKey;
  triggerMode: TriggerMode;
}

export const PROMPT_MODE_VALUES = ["minimal", "active", "custom"] as const;
export type PromptMode = (typeof PROMPT_MODE_VALUES)[number];
export type PresetPromptMode = Exclude<PromptMode, "custom">;

export const THEME_MODE_VALUES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODE_VALUES)[number];

// ── Azure / Microsoft Foundry 驗證模式 ─────────────────────
//
// 這裡刻意區分兩個概念，混用會讓 access token 被塞進 api-key header：
//
//  - AzureAuthMode（持久化 / UI）：使用者選了哪種驗證方式
//  - AzureAuthHeaderMode（wire）：實際請求要送哪種 HTTP header
//
// "entra"（服務主體 + client secret）與 "entraUser"（使用者登入）雖然是兩種
// 不同的取得 token 方式，但對 HTTP 層而言都是 Bearer；下游（llmProvider、
// Rust transcription）只認得 wire 模式，不該知道 token 怎麼來的。

export const AZURE_AUTH_MODE_VALUES = ["key", "entra", "entraUser"] as const;
export type AzureAuthMode = (typeof AZURE_AUTH_MODE_VALUES)[number];

/** HTTP 層的驗證方式：`key` → `api-key` header；`bearer` → `Authorization: Bearer`。 */
export type AzureAuthHeaderMode = "key" | "bearer";

export function isAzureAuthMode(value: unknown): value is AzureAuthMode {
  return (
    typeof value === "string" &&
    (AZURE_AUTH_MODE_VALUES as readonly string[]).includes(value)
  );
}

/** 來源不可信（store / 備份匯入）時用此正規化，未知值一律退回最保守的 `"key"`。 */
export function toAzureAuthMode(value: unknown): AzureAuthMode {
  return isAzureAuthMode(value) ? value : "key";
}

export function toAzureAuthHeaderMode(mode: AzureAuthMode): AzureAuthHeaderMode {
  return mode === "key" ? "key" : "bearer";
}

/** 需要使用者以自己的 Entra 帳號互動登入的模式。 */
export function isAzureUserAuthMode(mode: AzureAuthMode): boolean {
  return mode === "entraUser";
}
