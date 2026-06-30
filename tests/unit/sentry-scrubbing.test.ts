import { describe, expect, it } from "vitest";
import type { Breadcrumb, Event } from "@sentry/vue";
import {
  isValidSentryDsn,
  redactSensitiveString,
  scrubBreadcrumb,
  scrubEvent,
} from "../../src/lib/sentryScrubbing";

describe("redactSensitiveString", () => {
  it("[P0] 遮罩 OpenAI / Groq / Anthropic 風格的 API key", () => {
    expect(redactSensitiveString("key sk-proj-ABCDEF0123456789xyz done")).toBe(
      "key [redacted] done",
    );
    expect(redactSensitiveString("gsk_ABCDEFGHIJ0123456789")).toBe("[redacted]");
    expect(redactSensitiveString("sk-ant-ABCDEFGHIJ0123456789")).toBe(
      "[redacted]",
    );
  });

  it("[P0] 遮罩 Entra JWT 與 Bearer token", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(redactSensitiveString(`token ${jwt}`)).toBe("token [redacted]");
    expect(
      redactSensitiveString("Authorization: Bearer abcdef0123456789ABCDEF"),
    ).toContain("[redacted]");
  });

  it("[P1] 遮罩含 Windows 使用者名的路徑", () => {
    expect(
      redactSensitiveString("failed at C:\\Users\\alice\\AppData\\app.db"),
    ).toBe("failed at [redacted]\\AppData\\app.db");
  });

  it("[P1] 一般文字不受影響", () => {
    expect(redactSensitiveString("transcription failed (429)")).toBe(
      "transcription failed (429)",
    );
  });
});

describe("isValidSentryDsn", () => {
  it("[P0] 空字串 / undefined / null 視為無效", () => {
    expect(isValidSentryDsn("")).toBe(false);
    expect(isValidSentryDsn("   ")).toBe(false);
    expect(isValidSentryDsn(undefined)).toBe(false);
    expect(isValidSentryDsn(null)).toBe(false);
  });

  it("[P0] `__` 開頭的 CI 佔位符視為無效", () => {
    expect(isValidSentryDsn("__VITE_SENTRY_DSN__")).toBe(false);
  });

  it("[P0] 真實 DSN 視為有效", () => {
    expect(
      isValidSentryDsn("https://abc@o123.ingest.us.sentry.io/456"),
    ).toBe(true);
  });
});

describe("scrubBreadcrumb", () => {
  it("[P0] console breadcrumb 整顆丟棄（可能含轉錄文字）", () => {
    expect(scrubBreadcrumb({ category: "console", message: "我說的祕密" })).toBeNull();
  });

  it("[P0] ui.input breadcrumb 整顆丟棄（可能含輸入內容）", () => {
    expect(scrubBreadcrumb({ category: "ui.input" })).toBeNull();
  });

  it("[P1] fetch breadcrumb 去除 URL query 並遮罩祕密", () => {
    const result = scrubBreadcrumb({
      category: "fetch",
      data: { url: "https://api.example.com/v1?api-key=secret012345678" },
    });
    expect(result).not.toBeNull();
    expect((result?.data as Record<string, unknown>).url).toBe(
      "https://api.example.com/v1",
    );
  });

  it("[P1] 一般 breadcrumb 的 message 經過遮罩", () => {
    const result = scrubBreadcrumb({
      category: "navigation",
      message: "Bearer abcdef0123456789ABCDEF",
    });
    expect(result?.message).toContain("[redacted]");
  });
});

describe("scrubEvent", () => {
  it("[P0] extra 只保留白名單鍵，移除轉錄文字 / 字典詞等敏感鍵", () => {
    const event: Event = {
      extra: {
        source: "voice-flow",
        step: "enhancement",
        transcript: "使用者說的全文",
        vocabularyTerm: "某專案名",
        userMessage: "轉錄失敗",
      },
    };
    const result = scrubEvent(event);
    expect(result.extra).toEqual({ source: "voice-flow", step: "enhancement" });
    expect(result.extra).not.toHaveProperty("transcript");
    expect(result.extra).not.toHaveProperty("vocabularyTerm");
    expect(result.extra).not.toHaveProperty("userMessage");
  });

  it("[P0] 遮罩 message 與 exception value 內的祕密", () => {
    const event: Event = {
      message: "failed with sk-proj-ABCDEF0123456789",
      exception: {
        values: [{ type: "Error", value: "Bearer abcdef0123456789ABCDEF" }],
      },
    };
    const result = scrubEvent(event);
    expect(result.message).toBe("failed with [redacted]");
    expect(result.exception?.values?.[0].value).toContain("[redacted]");
  });

  it("[P0] 移除 request / user / server_name", () => {
    const event = {
      request: { url: "https://x/y?token=abc", headers: { a: "b" } },
      user: { id: "1", ip_address: "1.2.3.4" },
      server_name: "ALICE-PC",
    } as unknown as Event;
    const result = scrubEvent(event);
    expect(result.request).toBeUndefined();
    expect(result.user).toBeUndefined();
    expect(result.server_name).toBeUndefined();
  });

  it("[P0] 移除 Vue 元件 propsData（可能含轉錄文字）", () => {
    const event: Event = {
      contexts: {
        vue: { componentName: "NotchHud", propsData: { text: "祕密全文" } },
      },
    };
    const result = scrubEvent(event);
    const vue = result.contexts?.vue as Record<string, unknown>;
    expect(vue).not.toHaveProperty("propsData");
    expect(vue.componentName).toBe("NotchHud");
  });

  it("[P0] event.breadcrumbs 內的 console breadcrumb 被移除", () => {
    const event: Event = {
      breadcrumbs: [
        { category: "console", message: "祕密" },
        { category: "navigation", message: "/settings" },
      ],
    };
    const result = scrubEvent(event);
    expect(result.breadcrumbs).toHaveLength(1);
    expect(result.breadcrumbs?.[0].category).toBe("navigation");
  });
});
