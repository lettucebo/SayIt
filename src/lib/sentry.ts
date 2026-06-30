/// <reference types="vite/client" />
import * as Sentry from "@sentry/vue";
import type { App } from "vue";
import type { Router } from "vue-router";
import {
  isValidSentryDsn,
  scrubBreadcrumb,
  scrubEvent,
} from "./sentryScrubbing";

declare const __APP_VERSION__: string;

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

export function initSentryForHud(app: App): void {
  if (!isSentryEnabled()) return;

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

export function initSentryForDashboard(app: App, router: Router): void {
  if (!isSentryEnabled()) return;

  const tracesSampleRate = getTracesSampleRate();

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

  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(error);
    });
    return;
  }

  Sentry.captureException(error);
}
