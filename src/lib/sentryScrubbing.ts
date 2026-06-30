import type { Breadcrumb, Event } from "@sentry/vue";

// 隱私硬規則：以下敏感資料絕不可進入任何 Sentry event / breadcrumb
// （轉錄/LLM 文字、字典詞、API key·Azure 憑證·Entra token、其他 App 文字、剪貼簿）。
// 採 default-deny：extra 只保留已知安全鍵，其餘一律移除；可樣式化的祕密再額外遮罩。

const SAFE_EXTRA_KEYS = new Set(["source", "step", "window", "info"]);

const REDACTION = "[redacted]";

// 可用樣式偵測的祕密（API key / token / 含使用者名的路徑）。任意自然語言（轉錄文字等）
// 無法以樣式可靠偵測，因此主要靠 default-deny 結構與「不把敏感內容放進上報欄位」的程式紀律。
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:sk-ant|sk-proj|sk|gsk|sntrys|sntryu)[-_][A-Za-z0-9._-]{10,}/gi,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{10,}=*/gi,
  /\bapi-key["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}/gi,
  /[A-Za-z]:\\Users\\[^\\/\r\n"']+/gi,
  /\/Users\/[^/\r\n"']+/g,
];

export function redactSensitiveString(value: string): string {
  return SENSITIVE_PATTERNS.reduce((acc, re) => acc.replace(re, REDACTION), value);
}

// 鏡像 Rust 端（lib.rs）的 DSN 過濾：忽略空字串與 CI 佔位符（`__` 開頭）。
export function isValidSentryDsn(dsn: string | undefined | null): boolean {
  const trimmed = dsn?.trim() ?? "";
  return trimmed.length > 0 && !trimmed.startsWith("__");
}

// console 與輸入框（ui.input）breadcrumb 可能夾帶轉錄文字 / 剪貼簿內容 → 整顆丟棄。
const DROPPED_BREADCRUMB_CATEGORIES = new Set(["console", "ui.input"]);

function stripUrlQuery(url: string): string {
  const cutIndex = url.search(/[?#]/);
  return cutIndex >= 0 ? url.slice(0, cutIndex) : url;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (DROPPED_BREADCRUMB_CATEGORIES.has(breadcrumb.category ?? "")) {
    return null;
  }

  const scrubbed: Breadcrumb = { ...breadcrumb };

  if (typeof scrubbed.message === "string") {
    scrubbed.message = redactSensitiveString(scrubbed.message);
  }

  if (scrubbed.data && typeof scrubbed.data === "object") {
    const data: Record<string, unknown> = { ...scrubbed.data };
    if (typeof data.url === "string") {
      data.url = redactSensitiveString(stripUrlQuery(data.url));
    }
    scrubbed.data = data;
  }

  return scrubbed;
}

export function scrubEvent<T extends Event>(event: T): T {
  if (typeof event.message === "string") {
    event.message = redactSensitiveString(event.message);
  }

  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (typeof exception.value === "string") {
        exception.value = redactSensitiveString(exception.value);
      }
    }
  }

  // default-deny：只保留白名單 extra 鍵，其餘移除，避免轉錄文字等敏感資料外洩。
  if (event.extra) {
    const safeExtra: Record<string, unknown> = {};
    for (const key of Object.keys(event.extra)) {
      if (!SAFE_EXTRA_KEYS.has(key)) continue;
      const value = event.extra[key];
      safeExtra[key] =
        typeof value === "string" ? redactSensitiveString(value) : value;
    }
    event.extra = safeExtra;
  }

  // Vue 元件 props 可能含轉錄文字 → 移除。
  const vueContext = event.contexts?.vue as Record<string, unknown> | undefined;
  if (vueContext && "propsData" in vueContext) {
    delete vueContext.propsData;
  }

  // request（URL/query/headers/cookies）可能含 token、user / server_name 屬識別資訊 → 移除。
  if (event.request) delete event.request;
  if (event.user) delete event.user;
  if (event.server_name) delete event.server_name;

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map((crumb) => scrubBreadcrumb(crumb))
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }

  return event;
}
