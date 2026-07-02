/// <reference types="vite/client" />
import type * as SentryModule from "@sentry/vue";
import type { App } from "vue";
import type { Router } from "vue-router";
import {
  isValidSentryDsn,
  scrubBreadcrumb,
  scrubEvent,
} from "./sentryScrubbing";

declare const __APP_VERSION__: string;

// @sentry/vue is one of the heaviest deps shared by both entries (HUD + Dashboard).
// It is dynamically imported so it lands in its own chunk instead of the eagerly
// preloaded shared vendor chunk (perf audit F3). Errors raised before the dynamic
// import resolves are only logged to console — acceptable per plan (early errors
// are rare and non-fatal to keep out of the hot startup path).
let sentryModulePromise: Promise<typeof SentryModule> | null = null;

function loadSentryModule(): Promise<typeof SentryModule> {
  sentryModulePromise ??= import("@sentry/vue");
  return sentryModulePromise;
}

function getSentryDsn(): string {
  return import.meta.env.VITE_SENTRY_DSN?.trim() ?? "";
}

function getSentryEnvironment(): string {
  return import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || import.meta.env.MODE;
}

function getSentryRelease(): string {
  return import.meta.env.VITE_SENTRY_RELEASE?.trim() || `sayit@${__APP_VERSION__}`;
}

function getTracesSampleRate(): number {
  const rawValue = import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE?.trim();
  if (!rawValue) return 0;

  const rate = Number(rawValue);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

function isSentryEnabled(): boolean {
  return import.meta.env.PROD && isValidSentryDsn(getSentryDsn());
}

export async function initSentryForHud(app: App): Promise<void> {
  if (!isSentryEnabled()) return;

  const Sentry = await loadSentryModule();
  Sentry.init({
    app,
    dsn: getSentryDsn(),
    environment: getSentryEnvironment(),
    release: getSentryRelease(),
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    // Rust Application-mode session 為 release health 的單一來源；
    // 移除前端 BrowserSession,避免雙視窗各自起 session 造成重複計數。
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== "BrowserSession"),
    initialScope: {
      tags: { window: "hud" },
    },
  });
}

export async function initSentryForDashboard(
  app: App,
  router: Router,
): Promise<void> {
  if (!isSentryEnabled()) return;

  const tracesSampleRate = getTracesSampleRate();
  const Sentry = await loadSentryModule();

  Sentry.init({
    app,
    dsn: getSentryDsn(),
    environment: getSentryEnvironment(),
    release: getSentryRelease(),
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    // Rust Application-mode session 為 release health 的單一來源；移除前端 BrowserSession。
    integrations: (defaults) => {
      const base = defaults.filter(
        (integration) => integration.name !== "BrowserSession",
      );
      return tracesSampleRate > 0
        ? [...base, Sentry.browserTracingIntegration({ router })]
        : base;
    },
    ...(tracesSampleRate > 0 ? { tracesSampleRate } : {}),
    initialScope: {
      tags: { window: "dashboard" },
    },
  });
}

export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!isSentryEnabled()) return;

  // Sentry 尚未（動態）載入完成前發生的錯誤只記錄於 console，不阻塞/不排入熱路徑；
  // 一旦模組載入完成，之後的錯誤都會正常回報。
  if (!sentryModulePromise) return;

  void sentryModulePromise
    .then((Sentry) => {
      if (context) {
        Sentry.withScope((scope) => {
          scope.setExtras(context);
          Sentry.captureException(error);
        });
        return;
      }

      Sentry.captureException(error);
    })
    .catch((loadErr) => {
      // 動態 import 失敗時，避免 rejected promise 冒泡成 unhandledrejection →
      // 觸發全域 handler → 再次呼叫 captureError → 無限迴圈。此處吞掉並落 console。
      console.error(
        "[Sentry] capture skipped (module failed to load):",
        loadErr,
      );
    });
}
